"""Outils de recette : scénarios rejoués, jeu de démo, simulateur, garde production."""

import copy
from collections.abc import Sequence

import pytest
from app.config import Settings
from app.devtools import commands, runner, seed
from app.devtools.chat import chat_loop
from app.devtools.fakes import FakeCalendar, FakeKnowledge, FakeLLM
from app.devtools.scenarios import SCENARIOS, Expect, get_scenarios
from app.graph.ports import ChatMessage, Passage
from app.graph.state import Qualification
from app.models import Appointment, Campaign, FollowUp, Prospect
from app.models.enums import ConsentStatus, ConversionStage
from sqlalchemy import func, select


async def play(session_factory, mongo_db, scenario, llm=None):
    return await runner.run_scenario(session_factory, mongo_db, scenario, llm=llm or FakeLLM())


# --- Les scénarios du catalogue sont eux-mêmes vérifiés ---


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.name)
async def test_every_catalogue_scenario_passes_offline(session_factory, mongo_db, scenario):
    report = await play(session_factory, mongo_db, scenario)
    assert report.error is None, report.error
    failed = [
        f"tour {i} : {c.name} ({c.detail})"
        for i, t in enumerate(report.turns, 1)
        for c in t.checks
        if not c.ok
    ]
    assert report.ok and not failed, failed
    assert report.turns, "le scénario doit jouer au moins un tour"


def test_catalogue_covers_the_five_specification_scenarios():
    refs = {s.cdc_ref for s in SCENARIOS}
    assert {f"§12.2 n°{i}" for i in range(1, 6)} <= refs
    assert len({s.name for s in SCENARIOS}) == len(SCENARIOS)
    assert all(t.expect for s in SCENARIOS for t in s.turns)


def test_unknown_scenario_is_reported_with_the_available_names():
    with pytest.raises(KeyError, match="cold_prospect"):
        get_scenarios(["nope"])
    assert [s.name for s in get_scenarios(["opt_out"])] == ["opt_out"]


async def test_a_wrong_expectation_is_reported_as_a_gap(session_factory, mongo_db):
    scenario = copy.deepcopy(get_scenarios(["cold_prospect"])[0])
    scenario.turns[0].expect = Expect(action="human_handoff", stage_after="lost")
    report = await play(session_factory, mongo_db, scenario)
    assert not report.ok
    failing = {c.name for c in report.turns[0].checks if not c.ok}
    assert {"action", "étape"} <= failing
    assert "ÉCART" in runner.format_markdown([report], mode="test", model="fake")
    assert "action" in runner.format_console(report)


async def test_fake_only_scenarios_are_skipped_with_a_real_model(session_factory, mongo_db):
    class Plain:  # un modèle qui n'est pas la doublure scénarisée
        provider, model = "plain", "p"

        async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
            return "ok"

        async def extract(self, system, messages, schema):
            return Qualification(intent="other")

    report = await play(session_factory, mongo_db, get_scenarios(["llm_unavailable"])[0], Plain())  # type: ignore[arg-type]
    assert report.skipped and report.ok is False
    assert "ignoré" in runner.format_console(report)


async def test_report_is_readable_markdown(session_factory, mongo_db):
    reports = [
        await play(session_factory, mongo_db, s) for s in get_scenarios(["opt_out", "kb_answer"])
    ]
    md = runner.format_markdown(reports, mode="hors ligne", model="fake/fake-1")
    assert md.startswith("# Rapport de recette") and "2/2" in md
    assert "opt_out" in md and "conforme" in md and "Détail des échanges" in md


async def test_the_invention_trap_is_blocked_whatever_the_expectation(session_factory, mongo_db):
    """Même sans attente explicite, un chiffre inventé fait échouer le scénario."""
    scenario = copy.deepcopy(get_scenarios(["cold_prospect"])[0])
    scenario.turns[0].reply = "Bonjour Camille, la formation coûte 4500 euros."
    scenario.turns[0].expect = Expect()
    report = await play(session_factory, mongo_db, scenario)
    check = next(c for c in report.turns[0].checks if "NF-10" in c.name)
    assert check.ok  # l'agent a bloqué la réponse : rien d'inventé n'a été enregistré
    assert report.turns[0].handoff_reason == "reponse_non_verifiable"


# --- Jeu de données de démonstration ---


async def count(session, model):
    return (await session.scalar(select(func.count()).select_from(model))) or 0


async def test_seed_creates_a_coherent_dataset(session_factory, mongo_db):
    async with session_factory() as s:
        summary = await seed.seed_demo(s, mongo_db)
        assert summary.created == len(seed.DEMOS) == 14
        emails = list(await s.scalars(select(Prospect.email)))
        assert all(
            e.endswith("@demo.example.com") for e in emails
        )  # uniquement des adresses fictives
        assert await count(s, Campaign) == 3
        assert await count(s, Appointment) == 1 and await count(s, FollowUp) == 1
        opted = await s.scalar(
            select(Prospect).where(Prospect.email == "julie.garnier@demo.example.com")
        )
        assert opted.consent_status is ConsentStatus.OPTED_OUT
    handed = await mongo_db["conversations"].find_one({"handoff": {"$exists": True}})
    assert handed and handed["status"] == "handed_off" and handed["handoff"]["pending_question"]
    statuses = {c["status"] async for c in mongo_db["conversations"].find({})}
    assert {"open", "closed", "handed_off"} <= statuses


async def test_seed_covers_every_stage_family(session_factory, mongo_db):
    from app.models import CampaignProspect

    async with session_factory() as s:
        await seed.seed_demo(s, mongo_db)
        stages = set(await s.scalars(select(CampaignProspect.conversion_stage)))
    st = ConversionStage
    wanted = {
        st.NEW, st.CONTACTED, st.IN_CONVERSATION, st.QUALIFIED,
        st.MEETING_PROPOSED, st.MEETING_SCHEDULED, st.TO_FOLLOW_UP, st.LOST,
    }  # fmt: skip
    assert wanted <= stages


async def test_seed_is_idempotent_and_reset_rebuilds(session_factory, mongo_db):
    async with session_factory() as s:
        await seed.seed_demo(s, mongo_db)
        again = await seed.seed_demo(s, mongo_db)
        assert again.already_present and again.created == 0
        assert await count(s, Prospect) == 14
        rebuilt = await seed.seed_demo(s, mongo_db, reset=True)
        assert rebuilt.removed == 14 and rebuilt.created == 14
        assert await count(s, Prospect) == 14 and await count(s, Campaign) == 3


async def test_reset_only_removes_demo_data(session_factory, mongo_db):
    from app.schemas.prospect import ProspectIngest
    from app.services import prospects

    async with session_factory() as s:
        real, _, _ = await prospects.ingest_prospect(s, ProspectIngest(email="vrai@client.fr"))
        await seed.seed_demo(s, mongo_db)
        removed = await seed.reset_demo(s, mongo_db)
        assert removed == 14
        remaining = list(await s.scalars(select(Prospect.email)))
    assert remaining == ["vrai@client.fr"]
    assert await mongo_db["conversations"].count_documents({}) == 0


async def test_cleanup_removes_recette_prospects_but_keeps_the_demo_dataset(
    session_factory, mongo_db
):
    async with session_factory() as s:
        await seed.seed_demo(s, mongo_db)
    for scenario in get_scenarios(["opt_out", "cold_prospect"]):
        await play(session_factory, mongo_db, scenario)
    async with session_factory() as s:
        assert await count(s, Prospect) == 16
        removed = await commands.cleanup_recette(s, mongo_db)
        assert removed == 2 and await count(s, Prospect) == 14


# --- Simulateur de conversation ---


async def converse(session_factory, mongo_db, inputs, llm=None, **kw):
    lines = iter(inputs)
    out: list[str] = []
    await chat_loop(
        session_factory,
        mongo_db,
        llm=llm or FakeLLM(reply="Bonjour Camille, comment puis-je vous aider ?"),
        calendar=FakeCalendar(),
        knowledge=FakeKnowledge([Passage("demo (FICTIF)", "Le programme dure 18 mois.")]),
        read=lambda _prompt: next(lines),
        write=out.append,
        **kw,
    )
    return "\n".join(out)


async def test_chat_shows_reply_decision_and_state(session_factory, mongo_db):
    out = await converse(session_factory, mongo_db, ["Bonjour", "/state", "/quit"])
    assert "Agent > Bonjour Camille, comment puis-je vous aider ?" in out
    assert "décision :" in out and "étape :" in out and "consentement :" in out


async def test_chat_trace_toggle_and_empty_lines(session_factory, mongo_db):
    out = await converse(session_factory, mongo_db, ["", "/trace", "Bonjour", "/quit"])
    assert "trace détaillée : activée" in out and "· qualify_prospect" in out


async def test_chat_opt_out_then_reset_starts_a_fresh_prospect(session_factory, mongo_db):
    out = await converse(
        session_factory, mongo_db, ["STOP", "encore là ?", "/reset", "Bonjour", "/quit"]
    )
    assert "décision : opt_out" in out
    assert "/reset pour recommencer" in out  # la conversation clôturée refuse de nouveaux messages
    assert "nouveau prospect créé" in out


async def test_chat_stops_cleanly_at_end_of_input(session_factory, mongo_db):
    def boom(_prompt):
        raise EOFError

    out: list[str] = []
    await chat_loop(
        session_factory, mongo_db, llm=FakeLLM(), calendar=FakeCalendar(),
        knowledge=FakeKnowledge(), read=boom, write=out.append,
    )  # fmt: skip
    assert any("Simulateur" in line for line in out)


# --- Garde production et choix du modèle ---


def test_dev_commands_refuse_to_run_in_production(monkeypatch):
    prod = Settings(_env_file=None, environment="production", jwt_secret_key="x" * 40)
    monkeypatch.setattr(commands, "get_settings", lambda: prod)
    with pytest.raises(SystemExit, match="production"):
        commands.guard_not_production()
    with pytest.raises(SystemExit):
        commands.build_runtime(fake=True)


def test_live_mode_without_a_key_explains_what_to_do(monkeypatch):
    dev = Settings(_env_file=None, llm_provider="gemini")
    monkeypatch.setattr(commands, "get_settings", lambda: dev)
    with pytest.raises(SystemExit) as exc:
        commands.build_runtime(fake=False)
    message = str(exc.value)
    assert "GEMINI_API_KEY" in message and "--fake" in message


def test_offline_runtime_needs_no_key(monkeypatch):
    dev = Settings(_env_file=None)
    monkeypatch.setattr(commands, "get_settings", lambda: dev)
    rt = commands.build_runtime(fake=True)
    assert rt.llm.provider == "fake" and "hors ligne" in rt.mode


# --- La base de connaissances de test se comporte comme un vrai moteur de recherche ---


async def test_fake_knowledge_only_returns_relevant_passages():
    fact = Passage("demo (FICTIF)", "Le programme de démonstration dure 18 mois en alternance.")
    kb = FakeKnowledge([fact])
    assert await kb.search("Combien de temps dure le programme ?", None) == [fact]
    for unrelated in (
        "bonjour",
        "Quelles formations proposez-vous ?",
        "Combien coûte la formation ?",
        "",
    ):
        assert await kb.search(unrelated, None) == []
    assert kb.queries[0].startswith("Combien de temps")
