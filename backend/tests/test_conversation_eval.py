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
