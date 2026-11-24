"""Prospects simulés (`eval-simulation`) : profils, conversation jouée, passages, commande."""

import json
from collections.abc import Sequence

import pytest
from app.devtools import commands
from app.devtools import conversation_eval as ce
from app.devtools import prospect_sim as ps
from app.devtools.fakes import FakeLLM
from app.graph.ports import ChatMessage
from app.models import Prospect
from sqlalchemy import func, select

PERSONAS = ps.load_personas()


class ScriptedProspectModel:
    """Modèle de langage qui joue le prospect : réponses fixées, appels enregistrés."""

    provider = "test"
    model = "prospect"

    def __init__(self, replies: list[str]) -> None:
        self.replies = list(replies)
        self.calls: list[tuple[str, list[ChatMessage]]] = []

    async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
        self.calls.append((system, list(messages)))
        return self.replies.pop(0) if self.replies else ps.END_MARKER

    async def extract(self, system, messages, schema):  # pragma: no cover - jamais appelé
        raise NotImplementedError


def test_the_six_personas_are_complete_and_usable_offline():
    assert len(PERSONAS) == 6 and len({p.id for p in PERSONAS}) == 6
    for p in PERSONAS:
        assert p.goal and p.style and p.facts and p.opening.strip(), p.id
        assert 1 <= p.max_turns <= ps.MAX_TURNS_LIMIT, p.id
        assert p.script and p.script[0]["says"] == p.opening, p.id
        assert all(t["says"].strip() and t.get("fake", {}).get("qualification") for t in p.script)


def test_personas_can_be_selected_and_unknown_ids_are_refused():
    assert [p.id for p in ps.load_personas(["sceptique_robot"])] == ["sceptique_robot"]
    with pytest.raises(KeyError):
        ps.load_personas(["inconnu"])


def test_the_prospect_prompt_forbids_inventing_facts_about_the_programme():
    system = ps.prospect_system(PERSONAS[0])
    assert PERSONAS[0].goal in system and PERSONAS[0].facts in system
    assert "n'invente jamais" in system and ps.END_MARKER in system


@pytest.mark.parametrize("persona", PERSONAS, ids=[p.id for p in PERSONAS])
async def test_every_persona_plays_offline_and_is_conform(session_factory, mongo_db, persona):
    (r,) = await ps.run_simulations(session_factory, mongo_db, [persona], llm=FakeLLM())
    assert r.error is None and r.evaluable, ce.format_console(r)
    # Une question sans source est transférée : la conversation peut finir avant la fin du script.
    assert 1 <= len(r.turns) <= len(persona.script)
    assert r.transcript[0] == ("prospect", persona.opening)


async def test_a_second_model_plays_the_prospect_from_the_conversation_so_far(
    session_factory, mongo_db
):
    persona = ps.load_personas(["presse_rendez_vous"])[0]
    prospect_model = ScriptedProspectModel(["Demain en fin de journée, merci. [FIN]"])
    llm = FakeLLM()
    llm.qualification = None  # remplacé à chaque tour par la configuration du cas
    (r,) = await ps.run_simulations(
        session_factory, mongo_db, [persona], llm=llm, prospect_llm=prospect_model
    )
    assert r.error is None and r.transcript[0] == ("prospect", persona.opening)
    assert len(prospect_model.calls) == 1  # le premier message est celui du profil
    system, messages = prospect_model.calls[0]
    assert persona.goal in system
    # Du point de vue du prospect : ses messages sont ceux de « l'assistant », l'agent lui parle.
    assert messages[0].role == "assistant" and messages[0].content == persona.opening
    assert messages[-1].role == "user"
    prospect_messages = [t for role, t in r.transcript if role == "prospect"]
    assert prospect_messages[-1] == "Demain en fin de journée, merci."  # marqueur retiré
    assert len(prospect_messages) == 2  # fin demandée par le prospect


async def test_a_conversation_never_exceeds_the_turn_limit(session_factory, mongo_db):
    persona = ps.load_personas(["curieux_sans_projet"])[0]
    persona.max_turns = 2
    endless = ScriptedProspectModel(["Je regarde encore."] * 20)
    (r,) = await ps.run_simulations(
        session_factory, mongo_db, [persona], llm=FakeLLM(), prospect_llm=endless
    )
    assert len(r.turns) <= 2


async def test_passes_play_each_persona_several_times(session_factory, mongo_db):
    personas = ps.load_personas(["hors_sujet", "sceptique_robot"])
    results = await ps.run_simulations(session_factory, mongo_db, personas, llm=FakeLLM(), passes=2)
    assert [r.conversation.id for r in results] == [
        "hors_sujet#1", "hors_sujet#2", "sceptique_robot#1", "sceptique_robot#2",
    ]  # fmt: skip
    assert sum(len(r.turns) for r in results) >= 4  # chaque passage joue au moins un tour


async def test_command_writes_reports_and_cleans_up(
    session_factory, mongo_db, monkeypatch, tmp_path
):
    rt = commands.Runtime(session_factory, mongo_db, FakeLLM(), "hors ligne")
    monkeypatch.setattr(commands, "build_runtime", lambda fake: rt)

    async def no_shutdown() -> None:
        return None

    monkeypatch.setattr(commands, "_shutdown", no_shutdown)
    report, data = tmp_path / "sim.md", tmp_path / "sim.json"
    code = await commands.cmd_eval_simulation(
        ["hors_sujet"], fake=True, real_rag=False, passes=1, pause=0,
        report=str(report), json_path=str(data), cleanup=True,
    )  # fmt: skip
    assert code == 0 and "> **Prospect** :" in report.read_text(encoding="utf-8")
    assert json.loads(data.read_text(encoding="utf-8"))["conversations"]
    async with session_factory() as s:
        left = await s.scalar(
            select(func.count()).select_from(Prospect).where(Prospect.email.like(f"{ps.LABEL}.%"))
        )
    assert left == 0


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
        await commands.cmd_eval_simulation(
            [], fake=True, real_rag=False, passes=1, pause=0, report=None, json_path=None,
            cleanup=False,
        )  # fmt: skip
