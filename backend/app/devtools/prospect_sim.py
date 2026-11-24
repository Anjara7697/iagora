"""Prospects simulés (`python -m app.cli eval-simulation`).

`eval-conversations` rejoue des conversations écrites d'avance : le prospect dit toujours la même
chose. Ici, un SECOND modèle joue le prospect, message après message, à partir d'un profil
(`prospect_personas.json` : objectif, style, ce qu'il sait de lui). L'agent répond comme en
conditions réelles ; on mesure la conversation avec les mêmes indicateurs que `eval-conversations`
(`conversation_eval`), ce qui rend les chiffres comparables.

Chaque profil peut être joué plusieurs fois (`passes`) : le modèle varie d'un essai à l'autre, et
c'est cette variation que les conversations écrites d'avance ne montrent pas.

Garde-fous de l'outil :
- Prospects FICTIFS (`evalsim.*@demo.example.com`), base de connaissances de démonstration ; rien
  n'est envoyé. Comme tous les outils de recette, il ne s'exécute jamais en production.
- Le prospect simulé ne connaît pas la formation : il ne peut pas inventer un prix ou une durée
  et les faire passer pour des faits (le prompt le lui interdit, l'agent reste seul juge de ses sources).
- Hors ligne, le prospect rejoue le `script` du profil et l'agent utilise le faux modèle : aucun
  appel réseau, résultat reproductible (tests, CI).
"""

import asyncio
import json
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.devtools import conversation_eval, runner
from app.devtools.conversation_eval import Conversation, ConversationResult, Turn
from app.devtools.evaluation import LexicalKnowledge, MeteredLLM, play_turn
from app.devtools.fakes import FakeCalendar, FakeLLM
from app.graph.ports import ChatMessage, KnowledgeBase, LanguageModel

PERSONAS_FILE = Path(__file__).parent / "prospect_personas.json"
LABEL = "evalsim"  # adresses fictives : evalsim.<jeton>@demo.example.com
END_MARKER = "[FIN]"  # le prospect simulé met fin à la conversation (objectif atteint ou abandon)
MAX_TURNS_LIMIT = 12  # plafond de sécurité : un profil mal réglé ne boucle jamais


@dataclass
class Persona:
    id: str
    title: str
    goal: str
    style: str
    facts: str
    opening: str
    target: str = "ebihar_students"
    max_turns: int = 6
    script: list[dict[str, Any]] = field(default_factory=list)  # repli hors ligne


def load_personas(ids: Sequence[str] | None = None, path: Path = PERSONAS_FILE) -> list[Persona]:
    data = json.loads(path.read_text(encoding="utf-8"))
    personas = [Persona(**raw) for raw in data["personas"]]
    if ids:
        by_id = {p.id: p for p in personas}
        unknown = [i for i in ids if i not in by_id]
        if unknown:
            raise KeyError(f"Profil(s) inconnu(s) : {unknown}. Disponibles : {sorted(by_id)}")
        personas = [by_id[i] for i in ids]
    return personas


# --- Le prospect simulé ---


def prospect_system(persona: Persona) -> str:
    return (
        "Tu joues un PROSPECT FICTIF qui écrit à une école de formation (DATUM Academy). "
        "Tu n'es pas un assistant : tu es la personne qui écrit.\n"
        f"Ton objectif : {persona.goal}\n"
        f"Ta façon d'écrire : {persona.style}\n"
        f"Ce que tu sais de toi (tu peux le dire si on te le demande, rien de plus) : {persona.facts}\n"
        "Règles :\n"
        "- Écris UN seul message à la fois, en français, de une à trois phrases, sans guillemets "
        "ni préambule.\n"
        "- Tu ne connais PAS la formation : n'invente jamais un prix, une durée, une date ni une "
        "condition. Tu poses des questions, tu ne donnes pas de faits sur le programme.\n"
        "- Réponds à ce que l'agent vient de te dire ; ne répète pas ton message précédent.\n"
        f"- Quand ton objectif est atteint ou que tu abandonnes, écris ton dernier message suivi de {END_MARKER}."
    )


class ScriptedProspect:
    """Hors ligne : rejoue le `script` du profil (messages et comportement du faux modèle)."""

    def __init__(self, persona: Persona) -> None:
        self.persona = persona

    async def next(
        self, turn: int, transcript: Sequence[tuple[str, str]]
    ) -> tuple[str, dict[str, Any]]:
        if turn < len(self.persona.script):
            item = self.persona.script[turn]
            return item["says"], item.get("fake", {})
        return END_MARKER, {}


class LLMProspect:
    """En ligne : un modèle de langage joue le prospect."""

    def __init__(self, persona: Persona, llm: LanguageModel) -> None:
        self.persona = persona
        self.llm = llm

    async def next(
        self, turn: int, transcript: Sequence[tuple[str, str]]
    ) -> tuple[str, dict[str, Any]]:
        if turn == 0:
            return self.persona.opening, {}
        # Le prospect est le « assistant » de ce modèle : l'agent lui parle.
        messages = [
            ChatMessage(role="assistant" if role == "prospect" else "user", content=text)
            for role, text in transcript
        ]
        text = (await self.llm.generate(prospect_system(self.persona), messages)).strip()
        return text or END_MARKER, {}


# --- Jeu d'une conversation ---


def _clean(text: str) -> tuple[str, bool]:
    """Message sans le marqueur de fin, et vrai si le prospect met fin à la conversation."""
    ended = END_MARKER in text
    return text.replace(END_MARKER, "").strip(), ended


async def run_simulation(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    persona: Persona,
    *,
    llm: MeteredLLM,
    knowledge: KnowledgeBase,
    prospect: ScriptedProspect | LLMProspect,
    label: str | None = None,
) -> ConversationResult:
    conv = Conversation(
        id=label or persona.id, title=persona.title, turns=[], target=persona.target
    )
    result = ConversationResult(conv)
    calendar = FakeCalendar()
    said: list[str] = []
    max_turns = min(persona.max_turns, MAX_TURNS_LIMIT)
    try:
        async with session_factory() as session:
            ids = await runner.new_demo_prospect(
                session, db, label=LABEL, target_code=persona.target, profile={}
            )
            for index in range(max_turns):
                says, fake = await prospect.next(index, result.transcript)
                says, ended = _clean(says)
                if not says:
                    break
                turn = Turn(says=says, fake=fake)
                conv.turns.append(turn)
                r = await play_turn(
                    session, db, ids, conv.case(index), llm=llm, knowledge=knowledge,
                    calendar=calendar, said=said,
                )  # fmt: skip
                result.turns.append(r)
                result.seconds += r.seconds
                result.transcript.append(("prospect", says))
                result.transcript += [("agent", m) for m in r.agent_messages]
                said += [says, *r.agent_messages]
                if r.error or r.llm_unavailable:
                    break
                conversation_eval._measure(result, index, turn, r)
                result.final = r.observed
                if r.observed.get("conversation") != "open":
                    break  # transfert ou clôture : fin normale d'une conversation simulée
                if ended:
                    break
    except Exception as exc:  # une erreur technique est un résultat, pas un plantage de l'outil
        result.error = f"{type(exc).__name__}: {exc}"
    return result


async def run_simulations(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    personas: list[Persona],
    *,
    llm: LanguageModel,
    knowledge: KnowledgeBase | None = None,
    prospect_llm: LanguageModel | None = None,
    passes: int = 1,
    pause: float = 0.0,
    on_done: Callable[[ConversationResult], None] | None = None,
) -> list[ConversationResult]:
    """Joue chaque profil `passes` fois. Sans `prospect_llm` (hors ligne), le prospect rejoue son script."""
    metered = llm if isinstance(llm, MeteredLLM) else MeteredLLM(llm)
    kb = knowledge or LexicalKnowledge()
    results: list[ConversationResult] = []
    first = True
    for persona in personas:
        for n in range(1, max(1, passes) + 1):
            if not first and pause:
                await asyncio.sleep(pause)  # quota des formules gratuites
            first = False
            label = persona.id if passes <= 1 else f"{persona.id}#{n}"
            prospect: ScriptedProspect | LLMProspect = (
                LLMProspect(persona, prospect_llm)
                if prospect_llm is not None
                else ScriptedProspect(persona)
            )
            start = time.perf_counter()
            r = await run_simulation(
                session_factory,
                db,
                persona,
                llm=metered,
                knowledge=kb,
                prospect=prospect,
                label=label,
            )
            r.seconds = r.seconds or time.perf_counter() - start
            results.append(r)
            if on_done:
                on_done(r)
    return results


def is_scripted(llm: LanguageModel) -> bool:
    """Vrai si l'agent utilise le faux modèle (hors ligne)."""
    return isinstance(llm.inner if isinstance(llm, MeteredLLM) else llm, FakeLLM)
