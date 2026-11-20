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
from app.devtools import chat, conversation_eval, evaluation, kb_evaluation, runner, seed
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


def _cases_file(cases_path: str | None) -> dict[str, Path]:
    """Jeu de cas local (`--cas`), gardé hors Git quand il cite les vrais documents (D-28)."""
    if cases_path is None:
        return {}
    path = Path(cases_path)
    if not path.is_file():
        sys.exit(f"Jeu de cas introuvable : {path}")
    return {"path": path}


LOCAL_CASES_LABEL = "documents importés uniquement (jeu de cas local, démo écartée)"


def _eval_knowledge(rt: Runtime, *, real_rag: bool, local_cases: bool) -> tuple[KnowledgeBase, str]:
    """Base interrogée par une évaluation. Un jeu de cas local (`--cas`) porte sur les vrais
    documents d'une campagne : vraie recherche, sans les documents fictifs de démonstration."""
    if local_cases:
        return evaluation.ImportedDocumentsOnly(chat_knowledge(rt, fake=False)), LOCAL_CASES_LABEL
    if real_rag:
        kb = chat_knowledge(rt, fake=False)
        return kb, "recherche réelle (documents de démonstration chargés par seed-demo)"
    return evaluation.LexicalKnowledge(), "base FICTIVE de démonstration, recherche lexicale"


async def cmd_eval_agent(
    ids: list[str],
    *,
    fake: bool,
    categories: list[str] | None,
    ablation: str | None,
    real_rag: bool,
    pause: float,
    report: str | None,
    json_path: str | None,
    cleanup: bool,
    price_in: float | None,
    price_out: float | None,
    cases_path: str | None = None,
) -> int:
    """Mesure l'agent sur le jeu de cas annotés (voir `evaluation.py`)."""
    rt = build_runtime(fake=fake)
    try:
        cases = evaluation.load_cases(ids or None, categories, **_cases_file(cases_path))
    except KeyError as exc:
        sys.exit(str(exc.args[0]))
    if not cases:
        sys.exit("Aucun cas ne correspond aux filtres.")
    kb, kb_label = _eval_knowledge(rt, real_rag=real_rag, local_cases=cases_path is not None)
    variant = ablation or "complète"
    print(f"Évaluation de l'agent — mode {rt.mode} — variante {variant} — {len(cases)} cas\n")
    results = await evaluation.run_eval(
        rt.session_factory, rt.db, cases, llm=rt.llm, knowledge=kb, ablation=ablation,
        pause=pause, on_done=lambda r: print(evaluation.format_console(r)),
    )  # fmt: skip
    summary = evaluation.summarize(results, price_in=price_in, price_out=price_out)
    print(
        f"\nConformes : {summary.conform} — intention {summary.intent} — décision "
        f"{summary.decision} — transfert {summary.handoff} — sourcées {summary.grounded} — "
        f"forme {summary.channel_format}"
    )
    print(
        f"Chiffres non sourcés : bruts {summary.raw_hallucination}, envoyés "
        f"{summary.sent_hallucination} — modèle indisponible : {summary.llm_unavailable}"
    )
    model = f"{rt.llm.provider}/{rt.llm.model}"
    if report:
        Path(report).write_text(
            evaluation.format_markdown(
                results, summary, mode=rt.mode, model=model, ablation=ablation, knowledge=kb_label
            ),
            encoding="utf-8",
        )
        print(f"Rapport écrit : {report}")
    if json_path:
        Path(json_path).write_text(
            evaluation.to_json(
                results, summary, mode=rt.mode, model=model, ablation=ablation, knowledge=kb_label
            ),
            encoding="utf-8",
        )
        print(f"Résultats JSON écrits : {json_path}")
    if cleanup:
        async with rt.session_factory() as session:
            print(f"{await cleanup_recette(session, rt.db)} prospect(s) de recette supprimé(s).")
    await _shutdown()
    return 1 if summary.errors else 0


async def cmd_eval_conversations(
    ids: list[str],
    *,
    fake: bool,
    real_rag: bool,
    pause: float,
    report: str | None,
    json_path: str | None,
    cleanup: bool,
    cases_path: str | None = None,
) -> int:
    """Joue des conversations de plusieurs messages (voir `conversation_eval.py`)."""
    rt = build_runtime(fake=fake)
    try:
        convs = conversation_eval.load_conversations(ids or None, **_cases_file(cases_path))
    except KeyError as exc:
        sys.exit(str(exc.args[0]))
    kb, kb_label = _eval_knowledge(rt, real_rag=real_rag, local_cases=cases_path is not None)
    print(f"Évaluation de conversations — mode {rt.mode} — {len(convs)} conversation(s)\n")
    results = await conversation_eval.run_conversations(
        rt.session_factory, rt.db, convs, llm=rt.llm, knowledge=kb, pause=pause,
        on_done=lambda r: print(conversation_eval.format_console(r)),
    )  # fmt: skip
    summary = conversation_eval.summarize(results)
    print(
        f"\nConversations conformes : {summary.conform} — tours {summary.turns} — contexte "
        f"{summary.context} — parcours {summary.end}"
    )
    print(
        f"Redemandées : {summary.reasked} — salutations répétées : {summary.greetings_repeated} — "
        f"présentation IA : {summary.ai_self_intros} — ignorées : {summary.skipped}"
    )
    model = f"{rt.llm.provider}/{rt.llm.model}"
    if report:
        Path(report).write_text(
            conversation_eval.format_markdown(
                results, summary, mode=rt.mode, model=model, knowledge=kb_label
            ),
            encoding="utf-8",
        )
        print(f"Rapport écrit : {report}")
    if json_path:
        Path(json_path).write_text(
            conversation_eval.to_json(
                results, summary, mode=rt.mode, model=model, knowledge=kb_label
            ),
            encoding="utf-8",
        )
        print(f"Résultats JSON écrits : {json_path}")
    if cleanup:
        async with rt.session_factory() as session:
            print(f"{await cleanup_recette(session, rt.db)} prospect(s) de recette supprimé(s).")
    await _shutdown()
    return 1 if summary.errors else 0


async def cleanup_recette(session: AsyncSession, db: Any) -> int:
    """Supprime les prospects créés par les scénarios et le simulateur (pas le jeu de démo)."""
    labels = [s.name for s in SCENARIOS] + ["chat", evaluation.EVAL_LABEL, conversation_eval.LABEL]
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
            text="Le programme de démonstration, un Master 2 en ligne, dure 10 mois et se déroule entièrement à distance.",
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


async def cmd_kb_eval(*, json_path: str | None = None, cases_path: str | None = None) -> int:
    """Mesure la qualité de la recherche sur des questions types (calibrage du seuil)."""
    rt = build_runtime(fake=True)
    embeddings = require_embeddings()
    kb = PgKnowledgeBase(
        rt.session_factory,
        embeddings,
        min_score=get_settings().rag_min_score,
        include_demo=cases_path is None,  # jeu de cas local : vrais documents seulement
    )
    async with rt.session_factory() as session:
        title_to_slug = {d.title: d.slug for d in await knowledge.list_documents(session)}
    results = await kb_evaluation.run(
        kb,
        title_to_slug,
        kb_evaluation.load_cases(**_cases_file(cases_path)),
        on_done=lambda r: print(kb_evaluation.format_console(r)),
    )
    summary = kb_evaluation.summarize(results, kb.min_score)
    conform = summary["conform"]
    print(f"\n{conform['ok']}/{conform['total']} conformes — seuil actuel {kb.min_score}")
    if summary["relevant_score_min"] is not None and summary["off_topic_score_max"] is not None:
        print(f"Questions pertinentes : score min {summary['relevant_score_min']:.3f} ; "
              f"hors sujet : score max {summary['off_topic_score_max']:.3f}. "
              "Un bon seuil se situe entre les deux.")  # fmt: skip
    if summary["same_topic_scores"]:
        low, high = summary["same_topic_scores"]
        print(f"Même sujet sans réponse : scores {low:.3f} à {high:.3f}. "
              "Le seuil ne les sépare pas des vraies réponses : l'agent les signale et transfère.")  # fmt: skip
    if json_path:
        payload = kb_evaluation.to_payload(results, summary, model=embeddings.model_id)
        Path(json_path).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"Résultats JSON écrits : {json_path}")
    await _shutdown()
    return 1 if conform["ok"] < conform["total"] else 0


async def _shutdown() -> None:
    await dispose_engine()
    await close_clients()
