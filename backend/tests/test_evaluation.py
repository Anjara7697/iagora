"""Outil d'évaluation de l'agent (`eval-agent`) : jeu de cas, métriques, variantes, rapports."""

import json
import typing

import pytest
from app.config import Settings
from app.devtools import commands, evaluation
from app.devtools.evaluation import CaseResult, EvalCase, LexicalKnowledge
from app.devtools.fakes import FakeLLM
from app.graph.ports import LLMUnavailableError
from app.graph.state import Action, Intent, Qualification
from app.models import Prospect
from sqlalchemy import func, select

CASES = evaluation.load_cases()


async def play(session_factory, mongo_db, ids, *, ablation=None, llm=None):
    return await evaluation.run_eval(
        session_factory,
        mongo_db,
        evaluation.load_cases(ids),
        llm=llm or FakeLLM(),
        ablation=ablation,
    )


# --- Le jeu de cas est cohérent ---


def test_dataset_is_large_varied_and_well_formed():
    assert len(CASES) >= 40
    assert len({c.id for c in CASES}) == len(CASES)
    assert len({c.category for c in CASES}) >= 10
    intents = set(typing.get_args(Intent))
    actions = {a.value for a in Action}
    for c in CASES:
        assert set(c.intents) <= intents, c.id
        assert c.actions and set(c.actions) <= actions, c.id
        assert c.message is not None or not c.intents, c.id
        if c.fake.get("qualification"):
            Qualification(**c.fake["qualification"])  # annotation valide pour le faux modèle
    assert any(c.handoff for c in CASES) and any(c.handoff is False for c in CASES)
    assert any(c.must_mention for c in CASES)


def test_cases_can_be_filtered_by_id_and_category():
    assert [c.id for c in evaluation.load_cases(["opt_stop"])] == ["opt_stop"]
    assert {c.category for c in evaluation.load_cases(categories=["sensible"])} == {"sensible"}
    with pytest.raises(KeyError, match="opt_stop"):
        evaluation.load_cases(["nope"])


# --- Hors ligne, chaque cas annoté est conforme (l'outil et les règles sont vérifiés) ---


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
async def test_every_case_is_conform_offline(session_factory, mongo_db, case):
    [r] = await play(session_factory, mongo_db, [case.id])
    assert r.error is None, r.error
    assert r.ok, evaluation._gaps(r)


# --- Base de connaissances fictive : pertinence et filtrage par programme ---


async def test_lexical_knowledge_finds_the_fact_and_respects_the_programme():
    kb = LexicalKnowledge()
    found = await kb.search("Combien de temps dure le programme eBIHAR ?", "ebihar_students")
    assert found and "18 mois" in found[0].text and "FICTIF" in found[0].source
    assert await kb.search("Quel est le taux de réussite au diplôme ?", "ebihar_students") == []
    assert await kb.search("Bonjour.", "ebihar_students") == []
    # Les Compagnons n'est pas renvoyé à un prospect eBIHAR (comme la vraie base).
    pro = await kb.search("Combien de temps dure le programme Les Compagnons ?", "ebihar_students")
    assert all("Compagnons" not in p.source for p in pro)


# --- Mesures : chiffres inventés avant / après les garde-fous, variantes d'ablation ---


async def test_invented_price_is_counted_raw_but_never_sent(session_factory, mongo_db):
    [r] = await play(session_factory, mongo_db, ["prix_cout"])
    assert any(r.raw_claims), "le modèle a écrit un prix non sourcé"
    assert r.sent_claims == [] and r.handoff_reason == "reponse_non_verifiable"
    s = evaluation.summarize([r])
    assert s.raw_hallucination.ok >= 1 and s.sent_hallucination.ok == 0


@pytest.mark.parametrize("case_id", ["cond_cpf", "cond_sans_bac", "cond_duree_en_lettres"])
async def test_invented_conditions_and_spelled_durations_are_never_sent(
    session_factory, mongo_db, case_id
):
    """AUDIT-AI-001 : CPF, « sans le bac » et « deux ans » ne sont jamais envoyés. Sans extrait,
    la question part avant rédaction ; avec un extrait, la réponse est rejetée après rédaction."""
    [r] = await play(session_factory, mongo_db, [case_id])
    assert r.sent_claims == []
    assert r.handoff_reason in ("question_hors_base", "reponse_non_verifiable")


async def test_without_the_figure_check_the_invented_price_is_sent(session_factory, mongo_db):
    [r] = await play(session_factory, mongo_db, ["prix_cout"], ablation="sans-garde-chiffres")
    assert r.sent_claims and not r.ok
    assert evaluation.summarize([r]).sent_hallucination.ok == 1
    # La variante ne fuit pas : la vérification réelle est restaurée après le cas.
    assert evaluation.policy.ungrounded_claims("Prix : 4500 euros", []) == ["4500 euros"]


async def test_without_rag_covered_questions_are_handed_off(session_factory, mongo_db):
    [r] = await play(session_factory, mongo_db, ["kb_duree_ebihar"], ablation="sans-rag")
    assert r.handoff_reason == "question_hors_base"
    assert r.handoff_ok is False and r.grounded_ok is False


async def test_unknown_ablation_is_refused(session_factory, mongo_db):
    with pytest.raises(ValueError, match="sans-rag"):
        await play(session_factory, mongo_db, ["opt_stop"], ablation="sans-tout")


async def test_unavailable_model_is_counted_apart(session_factory, mongo_db):
    class Down:  # vrai modèle en panne (quota, clé, réseau)
        provider, model = "down", "d"

        async def generate(self, system, messages):
            raise LLMUnavailableError("quota")

        async def extract(self, system, messages, schema):
            raise LLMUnavailableError("quota")

    [r] = await play(session_factory, mongo_db, ["int_bts"], llm=Down())
    assert r.llm_unavailable and not r.evaluable and not r.ok
    s = evaluation.summarize([r])
    assert s.llm_unavailable == 1 and s.evaluable == 0 and str(s.conform) == "n/a"
    assert "modèle indisponible" in evaluation.format_console(r)
    assert [c.ok for c in r.calls] == [False]


async def test_metered_model_measures_calls(session_factory, mongo_db):
    [r] = await play(session_factory, mongo_db, ["int_m1_data"])
    assert [c.kind for c in r.calls] == ["extract", "generate"]
    assert all(c.ok and c.chars_in > 0 and c.chars_out > 0 for c in r.calls)
    assert r.seconds > 0 and r.intent == "interested"


async def test_eval_prospects_are_fictive_and_cleaned_up(session_factory, mongo_db):
    await play(session_factory, mongo_db, ["opt_stop", "pc_ebihar"])
    async with session_factory() as session:
        emails = list(await session.scalars(select(Prospect.email)))
        assert emails and all(e.startswith("eval.") for e in emails)
        assert all(e.endswith("@demo.example.com") for e in emails)
        assert await commands.cleanup_recette(session, mongo_db) == 2
        assert await session.scalar(select(func.count()).select_from(Prospect)) == 0


# --- Métriques et rapports ---


def _result(case_id: str, **kw) -> CaseResult:
    base = {c.id: c for c in CASES}[case_id]
    return CaseResult(EvalCase(**{**base.__dict__}), **kw)


def test_summary_counts_missed_and_unneeded_handoffs():
    results = [
        _result("hb_salaire", intent="question", action="continue_conversation"),  # manqué
        _result(
            "int_bts",
            intent="interested",
            action="human_handoff",
            handed_off=True,
            handoff_reason="incertitude",
        ),  # inutile
        _result(
            "cons_humain",
            intent="needs_advisor",
            action="human_handoff",
            handed_off=True,
            handoff_reason="demande_conseiller",
        ),
        _result("opt_stop", error="RuntimeError: boom"),
    ]
    s = evaluation.summarize(results)
    assert (s.cases, s.evaluable, s.errors) == (4, 3, 1)
    assert (s.handoff_expected, s.handoff_correct) == (2, 1)
    assert (s.handoff_missed, s.handoff_unneeded) == (1, 1)
    assert str(s.handoff) == "1/3 (33 %)"
    assert s.intent.ok == 3 and s.decision.ok == 2
    assert s.cost is None


def test_cost_is_only_computed_when_prices_are_given():
    r = _result("opt_stop", intent="opt_out", action="opt_out")
    r.calls = [evaluation.LLMCall("generate", 1.0, 4_000_000, 400_000, True)]
    assert evaluation.summarize([r]).cost is None
    s = evaluation.summarize([r], price_in=0.3, price_out=2.5)
    assert (s.tokens_in, s.tokens_out) == (1_000_000, 100_000)
    assert s.cost == pytest.approx(0.3 + 0.25)


def test_grounded_answer_accepts_alternatives_and_ignores_accents():
    r = _result("kb_langue", llm_written=["Les cours sont en Français."])
    assert r.grounded_ok is True
    r = _result("kb_admission_ebihar", llm_written=["Il faut un Bac +2."])
    assert r.grounded_ok is True
    r = _result("kb_duree_ebihar", llm_written=["Je n'ai pas cette information."])
    assert r.grounded_ok is False


async def test_reports_are_readable(session_factory, mongo_db):
    results = await play(session_factory, mongo_db, ["kb_duree_ebihar", "prix_cout"])
    results.append(_result("hb_cpf", intent="question", action="continue_conversation"))
    s = evaluation.summarize(results)
    md = evaluation.format_markdown(
        results, s, mode="test", model="fake/fake-1", ablation=None, knowledge="fictive"
    )
    for heading in ("## Synthèse", "## Par catégorie", "## Détail des cas", "## Écarts"):
        assert heading in md
    assert "hb_cpf" in md.split("## Écarts")[1] and "aucun transfert" in md
    data = json.loads(evaluation.to_json(results, s, mode="test"))
    assert data["summary"]["cases"] == 3 and len(data["cases"]) == 3
    assert data["meta"] == {"mode": "test"}


# --- Commande complète (hors ligne) et garde production ---


async def test_eval_command_writes_report_and_json(
    session_factory, mongo_db, monkeypatch, tmp_path
):
    rt = commands.Runtime(session_factory, mongo_db, FakeLLM(), "hors ligne (test)")
    monkeypatch.setattr(commands, "build_runtime", lambda fake: rt)

    async def no_shutdown():
        return None

    monkeypatch.setattr(commands, "_shutdown", no_shutdown)
    report, data = tmp_path / "eval.md", tmp_path / "eval.json"
    code = await commands.cmd_eval_agent(
        [],
        fake=True,
        categories=["desinscription", "sensible"],
        ablation=None,
        real_rag=False,
        pause=0,
        report=str(report),
        json_path=str(data),
        cleanup=True,
        price_in=None,
        price_out=None,
    )
    assert code == 0
    assert "Cas conformes | 7/7 (100 %)" in report.read_text(encoding="utf-8")
    assert json.loads(data.read_text(encoding="utf-8"))["summary"]["evaluable"] == 7
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(Prospect)) == 0


async def test_eval_command_refuses_to_run_in_production(monkeypatch):
    prod = Settings(
        _env_file=None,
        environment="production",
        jwt_secret_key="x" * 40,
        cors_origins=["https://console.datum.example"],
    )
    monkeypatch.setattr(commands, "get_settings", lambda: prod)
    with pytest.raises(SystemExit, match="production"):
        await commands.cmd_eval_agent(
            [],
            fake=True,
            categories=None,
            ablation=None,
            real_rag=False,
            pause=0,
            report=None,
            json_path=None,
            cleanup=False,
            price_in=None,
            price_out=None,
        )
