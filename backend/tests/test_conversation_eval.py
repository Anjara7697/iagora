"""Évaluation de conversations (`eval-conversations`) : jeu, vérifications à la longue, rapports."""

import json

import pytest
from app.devtools import commands
from app.devtools import conversation_eval as ce
from app.devtools.fakes import FakeLLM
from app.models import Prospect
from sqlalchemy import func, select

CONVERSATIONS = ce.load_conversations()
OFFLINE = [c for c in CONVERSATIONS if not c.live_only]


def test_dataset_has_real_multi_turn_conversations():
    assert len(CONVERSATIONS) >= 8
    assert len({c.id for c in CONVERSATIONS}) == len(CONVERSATIONS)
    assert sum(1 for c in CONVERSATIONS if len(c.turns) >= 3) >= 3
    assert any(t.context for c in CONVERSATIONS for t in c.turns)  # suivi du contexte mesuré
    assert any(t.known for c in CONVERSATIONS for t in c.turns)  # informations à ne pas redemander
    for c in CONVERSATIONS:
        assert all(t.says.strip() for t in c.turns), c.id
        # Hors ligne, chaque tour sait quoi répondre ; une conversation live_only s'en passe.
        if not c.live_only:
            assert all(t.fake.get("qualification") for t in c.turns), c.id


def test_conversations_can_be_selected_and_unknown_ids_are_refused():
    assert [c.id for c in ce.load_conversations(["arret_en_cours"])] == ["arret_en_cours"]
    with pytest.raises(KeyError):
        ce.load_conversations(["inexistante"])


@pytest.mark.parametrize("conv", OFFLINE, ids=[c.id for c in OFFLINE])
async def test_every_conversation_is_conform_offline(session_factory, mongo_db, conv):
    (r,) = await ce.run_conversations(session_factory, mongo_db, [conv], llm=FakeLLM())
    assert r.ok, ce.format_console(r)
    assert len(r.turns) == len(conv.turns) and r.end_ok is not False


async def test_live_only_conversations_are_skipped_offline(session_factory, mongo_db):
    live = [c for c in CONVERSATIONS if c.live_only]
    assert live  # le suivi du contexte n'a de sens qu'avec le vrai modèle
    results = await ce.run_conversations(session_factory, mongo_db, live, llm=FakeLLM())
    assert all(r.skipped for r in results)
    summary = ce.summarize(results)
    assert summary.skipped == len(live) and summary.evaluable == 0


# --- Ce qui ne se voit qu'à la longue ---


def test_a_repeated_greeting_and_an_unprompted_ai_introduction_are_detected():
    assert ce.repeats_greeting("Bonjour Camille, le programme dure 18 mois.")
    assert not ce.repeats_greeting("Le programme dure 18 mois. Bonjour chez vous !")
    assert ce.introduces_itself_as_ai("Je suis une intelligence artificielle et je ne sais pas.")
    assert ce.introduces_itself_as_ai("En tant qu'assistant, je préfère laisser un conseiller.")
    assert not ce.introduces_itself_as_ai("Un conseiller relit nos échanges.")


def test_a_question_about_known_information_is_detected():
    assert ce.asked_fields("Merci ! Quel est votre niveau d'études actuel ?") == ["study_level"]
    # Une affirmation n'est pas une question : seule une phrase interrogative compte.
    assert ce.asked_fields("Votre niveau d'études correspond au programme.") == []
    assert ce.question_count("Vous êtes libre ? Mardi ou jeudi ?") == 2


async def test_style_problems_make_the_conversation_fail(session_factory, mongo_db):
    """Le faux modèle salue à chaque message, se présente comme IA et redemande le niveau
    d'études : chaque défaut est compté et la conversation n'est pas conforme."""
    conv = ce.load_conversations(["sans_redemande"])[0]
    bad = "Bonjour Camille, je suis une intelligence artificielle. Quel est votre niveau d'études ?"
    for turn in conv.turns:
        turn.fake = {**turn.fake, "reply": bad}
        turn.must_mention = []
    (r,) = await ce.run_conversations(session_factory, mongo_db, [conv], llm=FakeLLM())
    assert not r.ok and all(t.ok for t in r.turns)  # chaque tour est juste, la conversation non
    assert r.greetings_repeated == 2 and r.ai_self_intros == 3
    assert r.reasked == ["tour 2 : study_level", "tour 3 : study_level"]


async def test_an_unexpected_handoff_stops_the_conversation(session_factory, mongo_db):
    conv = ce.load_conversations(["parcours_rdv_ebihar"])[0]
    conv.turns[1].fake = {"qualification": {"intent": "needs_advisor"}}
    (r,) = await ce.run_conversations(session_factory, mongo_db, [conv], llm=FakeLLM())
    assert r.stopped_early and len(r.turns) == 2 and not r.ok
    summary = ce.summarize([r])
    assert summary.handoff_unneeded == 1 and summary.stopped_early == 1


# --- Rapports et commande ---


async def test_reports_show_the_exchanges(session_factory, mongo_db):
    results = await ce.run_conversations(session_factory, mongo_db, CONVERSATIONS, llm=FakeLLM())
    summary = ce.summarize(results)
    assert summary.conform.ok == summary.conform.total == len(OFFLINE)
    md = ce.format_markdown(results, summary, mode="hors ligne", model="fake", knowledge="démo")
    assert "Conversations conformes" in md and "> **Prospect** :" in md and "> **Agent** :" in md
    data = json.loads(ce.to_json(results, summary, mode="hors ligne"))
    assert len(data["conversations"]) == len(CONVERSATIONS)
    assert data["summary"]["skipped"] == len(CONVERSATIONS) - len(OFFLINE)


async def test_command_writes_reports_and_cleans_up(
    session_factory, mongo_db, monkeypatch, tmp_path
):
    rt = commands.Runtime(session_factory, mongo_db, FakeLLM(), "hors ligne")
    monkeypatch.setattr(commands, "build_runtime", lambda fake: rt)

    async def no_shutdown() -> None:
        return None

    monkeypatch.setattr(commands, "_shutdown", no_shutdown)
    report, data = tmp_path / "conv.md", tmp_path / "conv.json"
    code = await commands.cmd_eval_conversations(
        ["arret_en_cours", "sans_redemande"], fake=True, real_rag=False, pause=0,
        report=str(report), json_path=str(data), cleanup=True,
    )  # fmt: skip
    assert code == 0 and "# Évaluation de conversations" in report.read_text(encoding="utf-8")
    assert json.loads(data.read_text(encoding="utf-8"))["summary"]["conform"]["ok"] == 2
    async with session_factory() as s:
        left = await s.scalar(
            select(func.count()).select_from(Prospect).where(Prospect.email.like(f"{ce.LABEL}.%"))
        )
    assert left == 0  # --cleanup supprime les prospects de recette


async def test_command_refuses_to_run_in_production(monkeypatch):
    from app.config import Settings

    monkeypatch.setattr(
        commands,
        "get_settings",
        lambda: Settings(
            _env_file=None,
            environment="production",
            jwt_secret_key="x" * 40,
            connectors_secret_key="k" * 40,
            cors_origins=["https://console.datum.example"],
        ),
    )
    with pytest.raises(SystemExit, match="production"):
        await commands.cmd_eval_conversations(
            [], fake=True, real_rag=False, pause=0, report=None, json_path=None, cleanup=False
        )


# --- Qualification et technique de vente (indicateurs) ---


@pytest.mark.parametrize(
    ("question", "kind"),
    [
        ("Qu'est-ce qui vous attire dans la data ?", "exploration"),
        ("Pourquoi souhaitez-vous changer de métier ?", "exploration"),
        ("Pourriez-vous m'indiquer quel est votre niveau d'études ?", "information"),
        ("Visez-vous la rentrée de septembre ou celle de l'an prochain ?", "alternative"),
        ("Souhaitez-vous que je vous mette en relation avec un conseiller ?", "fermée"),
        ("Où habitez-vous ?", "information"),
    ],
)
def test_question_kinds_follow_the_funnel_vocabulary(question, kind):
    assert ce.question_kind(question) == kind


def test_reformulation_advisor_offer_and_admission_verdict_are_detected():
    said = "Je suis chef de projet depuis 5 ans et je veux me former à la data."
    assert ce.reformulates(said, "Si je comprends bien, vous voulez évoluer dans votre poste.")
    assert ce.reformulates(said, "En tant que chef de projet, la data vous servira au quotidien.")
    assert not ce.reformulates("Combien de temps dure la formation ?", "Elle dure 18 mois.")
    assert ce.offers_advisor("Souhaitez-vous échanger avec un conseiller ?")
    assert not ce.offers_advisor("Un conseiller vous recevra en visioconférence.")
    assert ce.gives_eligibility_verdict("Votre profil correspond aux conditions d'admission.")
    assert ce.gives_eligibility_verdict("Votre BTS est tout à fait cohérent avec le programme.")
    assert not ce.gives_eligibility_verdict("L'admission est ouverte dès un Bac+2.")


def test_the_profile_read_is_compared_with_the_expected_one():
    profile = {"study_level": "BTS SIO", "goal": "devenir data analyst"}
    assert ce.profile_matches(profile, {"study_level": "bts", "goal": "data analyst|data"})
    assert not ce.profile_matches(profile, {"study_level": "licence|bac+3"})
    assert not ce.profile_matches({}, {"goal": "data"})


async def test_a_profile_not_read_makes_the_conversation_fail(session_factory, mongo_db):
    conv = ce.load_conversations(["parcours_rdv_ebihar"])[0]
    conv.turns[0].fake = {**conv.turns[0].fake, "qualification": {"intent": "interested"}}
    (r,) = await ce.run_conversations(session_factory, mongo_db, [conv], llm=FakeLLM())
    assert r.profile_checks[0] is False and not r.ok
    assert any("profil lu" in i for i in ce._issues(r))


async def test_sales_indicators_are_measured_without_changing_conformity(session_factory, mongo_db):
    convs = ce.load_conversations(["parcours_rdv_ebihar", "prospect_engage"])
    results = await ce.run_conversations(session_factory, mongo_db, convs, llm=FakeLLM())
    parcours, engage = results
    assert parcours.ok and engage.ok  # les indicateurs ne changent pas la conformité
    assert parcours.meeting_turn == 3  # le prospect a demandé le rendez-vous au tour 3
    # Créneaux et confirmation en pleine conversation : plus de « Bonjour » (D-33).
    assert parcours.template_greetings == 0 and parcours.greetings_repeated == 0
    # Grille complète au tour 3 et question d'admission : réponse puis créneaux, de lui-même.
    assert engage.meeting_turn == 3 and engage.meeting_on_time is True
    assert "exploration" in engage.question_kinds
    summary = ce.summarize(results)
    indicators = summary.as_dict()["sales_indicators"]
    kinds = {"exploration", "information", "alternative", "fermée"}
    assert set(indicators["question_kinds"]) == kinds
    md = ce.format_markdown(results, summary, mode="hors ligne", model="fake", knowledge="démo")
    assert "Qualification et technique de vente" in md and "Rendez-vous proposé à temps" in md
