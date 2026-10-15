"""Commandes de développement (`python -m app.cli seed-demo | scenario | chat`).

Elles refusent de s'exécuter en production : elles créent et suppriment des données de démo.
"""

import json
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agents.defaults import EmptyKnowledgeBase
from app.config import get_settings
from app.database.clients import close_clients, get_mongo_db
from app.database.session import dispose_engine, get_sessionmaker
from app.devtools import chat, runner, seed
from app.devtools.fakes import FakeCalendar, FakeKnowledge, FakeLLM
from app.devtools.scenarios import SCENARIOS, get_scenarios
from app.graph.ports import KnowledgeBase, LanguageModel, Passage
from app.integrations.embeddings.factory import create_embeddings
from app.integrations.knowledge.factory import create_knowledge_base
from app.integrations.knowledge.pg_knowledge import PgKnowledgeBase
from app.integrations.llm.factory import NullLanguageModel, create_language_model
from app.kb_commands import require_embeddings
from app.models import Prospect
from app.services import knowledge

DEMO_KB_DIR = Path(__file__).parent / "demo_kb"


def guard_not_production() -> None:
    if get_settings().environment == "production":
        sys.exit("Commande de développement : refusée quand ENVIRONMENT=production.")


@dataclass
class Runtime:
    session_factory: async_sessionmaker[AsyncSession]
    db: Any
    llm: LanguageModel
    mode: str


def build_runtime(*, fake: bool) -> Runtime:
    guard_not_production()
    # Les journaux techniques (avertissements, nouveaux essais) noieraient l'affichage de recette.
    logging.getLogger("app").setLevel(logging.ERROR)
    settings = get_settings()
    if fake:
        llm: LanguageModel = FakeLLM()
        mode = "hors ligne (faux modèle scripté)"
    else:
        llm = create_language_model(settings)
        if isinstance(llm, NullLanguageModel):
            sys.exit(
                f"Aucun modèle utilisable ({llm.provider}) : {llm._reason}\n"
                "Renseignez la clé dans votre .env, ou utilisez --fake pour un essai hors ligne."
            )
        mode = f"réel ({llm.provider}/{llm.model})"
    return Runtime(get_sessionmaker(), get_mongo_db(), llm, mode)


async def cmd_seed(*, reset: bool) -> None:
    rt = build_runtime(fake=True)
    async with rt.session_factory() as session:
        summary = await seed.seed_demo(session, rt.db, reset=reset)
    await load_demo_kb(rt, reset=reset)
    if summary.already_present:
        print("Les données de démonstration existent déjà (utilisez --reset pour les recréer).")
    else:
        removed = f" ({summary.removed} ancien(s) supprimé(s))" if summary.removed else ""
        print(f"{summary.created} prospects de démonstration créés{removed}.")
        print("Adresses en @demo.example.com ; campagnes préfixées « [DÉMO] ».")
    await _shutdown()


async def cmd_scenarios(names: list[str], *, fake: bool, report: str | None, cleanup: bool) -> int:
    rt = build_runtime(fake=fake)
    scenarios = get_scenarios(names or None)
    print(f"Recette de l'agent — mode {rt.mode} — {len(scenarios)} scénario(s)\n")
    reports = await runner.run_all(
        rt.session_factory, rt.db, scenarios, llm=rt.llm,
        on_done=lambda r: print(runner.format_console(r)),
    )  # fmt: skip
    ran = [r for r in reports if r.skipped is None]
    ok = sum(1 for r in ran if r.ok)
    print(f"\nRésultat : {ok}/{len(ran)} scénarios conformes.")
    if report:
        Path(report).write_text(
            runner.format_markdown(
                reports, mode=rt.mode, model=f"{rt.llm.provider}/{rt.llm.model}"
            ),
            encoding="utf-8",
        )
        print(f"Rapport écrit : {report}")
    if cleanup:
        async with rt.session_factory() as session:
            print(f"{await cleanup_recette(session, rt.db)} prospect(s) de recette supprimé(s).")
    await _shutdown()
    return 0 if ok == len(ran) else 1


async def cleanup_recette(session: AsyncSession, db: Any) -> int:
    """Supprime les prospects créés par les scénarios et le simulateur (pas le jeu de démo)."""
    labels = [s.name for s in SCENARIOS] + ["chat"]
    ids = list(
        await session.scalars(
            select(Prospect.id).where(
                or_(*[Prospect.email.like(f"{label}.%@{runner.DEMO_DOMAIN}") for label in labels])
            )
        )
    )
    if ids:
        await db["conversations"].delete_many({"prospect_id": {"$in": ids}})
        await db["agent_runs"].delete_many({"prospect_id": {"$in": ids}})
        await session.execute(delete(Prospect).where(Prospect.id.in_(ids)))
        await session.commit()
    return len(ids)


def chat_knowledge(rt: Runtime, *, fake: bool) -> KnowledgeBase:
    """Hors ligne : un seul fait fictif. Avec le vrai modèle : la vraie recherche RAG (base de
    démonstration chargée par `seed-demo`, ou documents ingérés)."""
    if fake:
        demo_fact = Passage(
            source="demo (FICTIF)",
            text="Le programme de démonstration dure 18 mois et se déroule en alternance.",
        )
        return FakeKnowledge([demo_fact])
    kb = create_knowledge_base(get_settings(), rt.session_factory)
    if kb is None:
        print(
            "(RAG désactivé : clé d'embeddings absente — les questions factuelles seront transférées)"
        )
        return EmptyKnowledgeBase()
    return kb


async def cmd_chat(*, fake: bool, target: str, trace: bool) -> None:
    rt = build_runtime(fake=fake)
    await chat.chat_loop(
        rt.session_factory,
        rt.db,
        llm=rt.llm,
        calendar=FakeCalendar(),  # agenda de démonstration : aucun vrai rendez-vous
        knowledge=chat_knowledge(rt, fake=fake),
        target_code=target,
        show_trace=trace,
    )
    await _shutdown()


async def load_demo_kb(rt: Runtime, *, reset: bool) -> None:
    """Charge la base de connaissances FICTIVE (documents de `demo_kb/`), marquée `is_demo`."""
    embeddings = create_embeddings(get_settings())
    if embeddings is None:
        print(
            "Base de connaissances de démo non chargée : clé d'embeddings absente (GEMINI_API_KEY)."
        )
        return
    async with rt.session_factory() as session:
        if reset:
            await knowledge.delete_demo_documents(session)
        for file in sorted(DEMO_KB_DIR.glob("*.md")):
            result = await knowledge.ingest_document(
                session, embeddings, file.stem, file.read_text(encoding="utf-8"), is_demo=True
            )
            print(f"  base de démo : {file.stem} {result.status.value} ({result.chunks} extraits)")


async def cmd_kb_eval() -> int:
    """Mesure la qualité de la recherche sur des questions types (calibrage du seuil)."""
    rt = build_runtime(fake=True)
    embeddings = require_embeddings()
    kb = PgKnowledgeBase(
        rt.session_factory, embeddings, min_score=get_settings().rag_min_score, include_demo=True
    )
    async with rt.session_factory() as session:
        title_to_slug = {d.title: d.slug for d in await knowledge.list_documents(session)}
    cases = json.loads((DEMO_KB_DIR / "eval.json").read_text(encoding="utf-8"))
    hits, hit_scores, miss_scores, failures = 0, [], [], 0
    for case in cases:
        passages = await kb.search_all(case["question"], case["target"], 1)
        top = passages[0] if passages else None
        score = top.score or 0.0 if top else 0.0
        slug = title_to_slug.get(top.source.split(" / ")[0]) if top else None
        retained = top is not None and score >= kb.min_score
        if case["expect"] is None:
            ok = not retained
            miss_scores.append(score)
        else:
            ok = retained and slug == case["expect"]
            hit_scores.append(score)
        failures += not ok
        print(f"{'✓' if ok else '✗'} [{score:.3f}] {case['question']}  → {slug or '—'}"
              f"{'' if retained else ' (écarté)'}")  # fmt: skip
        hits += ok
    print(f"\n{hits}/{len(cases)} conformes — seuil actuel {kb.min_score}")
    if hit_scores and miss_scores:
        print(f"Questions pertinentes : score min {min(hit_scores):.3f} ; "
              f"hors sujet : score max {max(miss_scores):.3f}. "
              "Un bon seuil se situe entre les deux.")  # fmt: skip
    await _shutdown()
    return 1 if failures else 0


async def _shutdown() -> None:
    await dispose_engine()
    await close_clients()
