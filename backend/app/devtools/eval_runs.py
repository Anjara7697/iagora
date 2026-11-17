"""Passages d'évaluation de la page Évaluation (outil de recette : jamais en production).

Un passage joue l'une des trois évaluations existantes, exactement comme la ligne de commande :
- `agent` : les cas un par un (`evaluation.py`, `eval-agent`) ;
- `conversations` : les conversations de plusieurs messages (`conversation_eval.py`) ;
- `kb` : la recherche dans la base de connaissances (`kb_evaluation.py`, `kb-eval`).

Il tourne en tâche de fond dans le processus de l'API, un seul à la fois, et peut être annulé : les
résultats déjà obtenus sont alors gardés. Le rapport (le même JSON que `--json`) est enregistré dans
la collection `eval_runs` avec des indicateurs normalisés, pour comparer deux passages et suivre
leur évolution. Les rapports produits en ligne de commande s'importent dans le même historique.

Seuls des prospects fictifs (`@demo.example.com`) sont créés, et supprimés à la fin si demandé.
"""

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agents.defaults import EmptyKnowledgeBase
from app.config import Settings
from app.devtools import conversation_eval, evaluation, kb_evaluation
from app.devtools.fakes import FakeLLM
from app.graph.ports import KnowledgeBase, LanguageModel
from app.integrations.embeddings.base import EmbeddingModel
from app.integrations.knowledge.factory import create_knowledge_base
from app.integrations.knowledge.pg_knowledge import PgKnowledgeBase
from app.integrations.llm.factory import NullLanguageModel
from app.services import knowledge

logger = logging.getLogger(__name__)

COLLECTION = "eval_runs"
Suite = Literal["agent", "conversations", "kb"]
SUITE_LABELS: dict[str, str] = {
    "agent": "Cas un par un",
    "conversations": "Conversations",
    "kb": "Base de connaissances",
}
# Appels au modèle de langage par message du prospect (lecture du message, puis rédaction) :
# estimation affichée avant un passage avec le vrai modèle (quota).
LLM_CALLS_PER_TURN = 2
MAX_IMPORT_BYTES = 8_000_000


class EvaluationError(Exception):
    """Passage impossible : réglage invalide, modèle ou embeddings indisponibles."""


class RunInProgress(EvaluationError):
    """Un passage tourne déjà : un seul à la fois (quota du modèle, base partagée)."""


class RunSettings(BaseModel):
    """Réglages d'un passage. Ceux qui ne concernent pas la suite choisie sont ignorés."""

    suite: Suite
    label: str = Field(min_length=1, max_length=120)
    notes: str = Field("", max_length=4000)
    live: bool = Field(False, description="Vrai modèle (sinon faux modèle scripté, gratuit)")
    real_rag: bool = Field(False, description="Vraie recherche sur la base de démonstration")
    pause: float = Field(0.0, ge=0, le=60, description="Secondes entre deux cas (quota)")
    ids: list[str] = Field(default_factory=list, max_length=500, description="Vide : tout")
    categories: list[str] = Field(default_factory=list, max_length=50)
    ablation: Literal["sans-rag", "sans-garde-chiffres"] | None = None
    price_in: float | None = Field(None, ge=0, description="Prix par million de jetons (entrée)")
    price_out: float | None = Field(None, ge=0, description="Prix par million de jetons (sortie)")
    min_score: float | None = Field(None, ge=0, le=1, description="Seuil essayé (base)")
    cleanup: bool = Field(True, description="Supprimer les prospects fictifs à la fin")

    def effective(self) -> dict[str, Any]:
        """Les seuls réglages qui comptent pour cette suite (affichés avec le passage)."""
        if self.suite == "kb":
            return {"min_score": self.min_score}
        out: dict[str, Any] = {
            "live": self.live,
            "real_rag": self.real_rag,
            "pause": self.pause,
            "ids": self.ids,
            "cleanup": self.cleanup,
        }
        if self.suite == "agent":
            out |= {
                "categories": self.categories,
                "ablation": self.ablation,
                "price_in": self.price_in,
                "price_out": self.price_out,
            }
        return out


# --- Ce que l'on peut lancer ---


def catalog(
    app_settings: Settings, llm: LanguageModel, embeddings: EmbeddingModel | None
) -> dict[str, Any]:
    """Suites, cas et conversations disponibles, et ce qui est utilisable (modèle, embeddings)."""
    cases = evaluation.load_cases()
    convs = conversation_eval.load_conversations()
    kb_cases = kb_evaluation.load_cases()
    model_ok = not isinstance(llm, NullLanguageModel)
    return {
        "suites": [
            {
                "key": "agent",
                "label": SUITE_LABELS["agent"],
                "items": [
                    {"id": c.id, "title": c.message or "(premier contact)", "group": c.category}
                    for c in cases
                ],
                "categories": sorted({c.category for c in cases}),
                "ablations": list(evaluation.ABLATIONS),
            },
            {
                "key": "conversations",
                "label": SUITE_LABELS["conversations"],
                "items": [
                    {
                        "id": c.id,
                        "title": c.title,
                        "turns": len(c.turns),
                        "live_only": c.live_only,
                    }
                    for c in convs
                ],
            },
            {
                "key": "kb",
                "label": SUITE_LABELS["kb"],
                "items": [
                    {"id": str(i), "title": c.question, "group": c.target}
                    for i, c in enumerate(kb_cases)
                ],
            },
        ],
        "model": {
            "available": model_ok,
            "name": f"{llm.provider}/{llm.model}" if model_ok else None,
        },
        "embeddings": {
            "available": embeddings is not None,
            "name": embeddings.model_id if embeddings is not None else None,
        },
        "rag_min_score": app_settings.rag_min_score,
        "llm_calls_per_turn": LLM_CALLS_PER_TURN,
        "running": _ACTIVE.run_id if _ACTIVE is not None and not _ACTIVE.task.done() else None,
    }


# --- Indicateurs normalisés (comparaison et évolution) ---


def _get(data: dict[str, Any], path: str) -> Any:
    value: Any = data
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _rate(data: dict[str, Any], path: str) -> tuple[float | None, str]:
    r = _get(data, path)
    if not isinstance(r, dict) or not r.get("total"):
        return None, "n/a"
    ok, total = r.get("ok", 0), r["total"]
    return ok / total, f"{ok}/{total} ({100 * ok / total:.0f} %)"


def _number(data: dict[str, Any], path: str, unit: str = "") -> tuple[float | None, str]:
    v = _get(data, path)
    if not isinstance(v, int | float) or isinstance(v, bool):
        return None, "n/a"
    shown = f"{v:.1f}" if isinstance(v, float) and not v.is_integer() else f"{v:g}"
    return float(v), f"{shown}{unit}"


# (clé, libellé, groupe, chemin dans le résumé, sorte, sens du progrès)
_Spec = tuple[str, str, str, str, str, str | None]
_INDICATORS: dict[str, list[_Spec]] = {
    "agent": [
        ("conform", "Cas conformes", "Conformité", "conform", "rate", "up"),
        ("intent", "Intention lue juste", "Conformité", "intent_accuracy", "rate", "up"),
        ("decision", "Décision juste", "Conformité", "decision_accuracy", "rate", "up"),
        ("handoff", "Transfert juste", "Conformité", "handoff_accuracy", "rate", "up"),
        ("handoff_missed", "Transferts manqués", "Conformité", "handoff.missed", "n", "down"),
        ("handoff_unneeded", "Transferts inutiles", "Conformité", "handoff.unneeded", "n", "down"),
        ("grounded", "Réponses sourcées", "Exactitude", "grounded_answers", "rate", "up"),
        (
            "ungrounded_raw",
            "Chiffres non sourcés (bruts)",
            "Exactitude",
            "ungrounded_raw",
            "rate",
            "down",
        ),
        (
            "ungrounded_sent",
            "Chiffres non sourcés (envoyés)",
            "Exactitude",
            "ungrounded_sent",
            "rate",
            "down",
        ),
        ("latency", "Durée médiane par cas", "Coût", "latency_seconds.median", "s", "down"),
        ("llm_calls", "Appels au modèle", "Coût", "llm_calls", "n", None),
        ("unavailable", "Modèle indisponible", "Coût", "llm_unavailable", "n", "down"),
        ("errors", "Erreurs techniques", "Coût", "errors", "n", "down"),
    ],  # fmt: skip
    "conversations": [
        ("conform", "Conversations conformes", "Conformité", "conform", "rate", "up"),
        ("turns", "Tours conformes", "Conformité", "turns_conform", "rate", "up"),
        ("context", "Contexte suivi", "Conformité", "context_followed", "rate", "up"),
        ("grounded", "Réponses sourcées", "Conformité", "grounded_answers", "rate", "up"),
        ("journey", "Parcours menés au bout", "Conformité", "journey_end", "rate", "up"),
        ("profile", "Profil lu juste", "Conformité", "profile_read", "rate", "up"),
        ("handoff_missed", "Transferts manqués", "Conformité", "handoff.missed", "n", "down"),
        ("handoff_unneeded", "Transferts inutiles", "Conformité", "handoff.unneeded", "n", "down"),
        ("stopped_early", "Arrêtées trop tôt", "Conformité", "stopped_early", "n", "down"),
        ("reasked", "Informations redemandées", "Style", "reasked", "n", "down"),
        ("greetings", "Salutations répétées", "Style", "greetings_repeated", "n", "down"),
        ("ai_intros", "Présentation IA non demandée", "Style", "ai_self_intros", "n", "down"),
        (
            "multi_questions",
            "Messages à plusieurs questions",
            "Style",
            "multi_questions",
            "n",
            "down",
        ),
        (
            "sent_claims",
            "Messages avec chiffre non sourcé",
            "Style",
            "sent_with_ungrounded_claims",
            "n",
            "down",
        ),
        (
            "meeting",
            "Rendez-vous proposé à temps",
            "Technique de vente",
            "sales_indicators.meeting_proposed_on_time",
            "rate",
            "up",
        ),
        (
            "q_exploration",
            "Questions d'exploration",
            "Technique de vente",
            "sales_indicators.question_kinds.exploration",
            "n",
            "up",
        ),
        (
            "q_alternative",
            "Questions alternatives",
            "Technique de vente",
            "sales_indicators.question_kinds.alternative",
            "n",
            "up",
        ),
        (
            "q_information",
            "Questions d'information",
            "Technique de vente",
            "sales_indicators.question_kinds.information",
            "n",
            None,
        ),
        (
            "q_closed",
            "Questions fermées",
            "Technique de vente",
            "sales_indicators.question_kinds.fermée",
            "n",
            "down",
        ),
        (
            "reformulations",
            "Reformulations",
            "Technique de vente",
            "sales_indicators.reformulations",
            "n",
            "up",
        ),
        (
            "words",
            "Longueur médiane des messages",
            "Technique de vente",
            "sales_indicators.words_median",
            " mots",
            "down",
        ),
        (
            "long_messages",
            "Messages trop longs",
            "Technique de vente",
            "sales_indicators.long_messages",
            "n",
            "down",
        ),
        (
            "advisor_offers",
            "Offres de conseiller",
            "Technique de vente",
            "sales_indicators.advisor_offers",
            "n",
            "down",
        ),
        (
            "eligibility",
            "Avis d'admission donnés",
            "Technique de vente",
            "sales_indicators.eligibility_verdicts",
            "n",
            "down",
        ),
        (
            "template_greetings",
            "Salutations dans les messages fixes",
            "Technique de vente",
            "sales_indicators.template_greetings",
            "n",
            "down",
        ),
        (
            "repeated_questions",
            "Questions reposées",
            "Technique de vente",
            "sales_indicators.repeated_questions",
            "n",
            "down",
        ),
        (
            "latency",
            "Durée médiane par conversation",
            "Coût",
            "latency_seconds_median",
            "s",
            "down",
        ),
        ("llm_calls", "Appels au modèle", "Coût", "llm_calls", "n", None),
        ("unavailable", "Modèle indisponible", "Coût", "llm_unavailable", "n", "down"),
        ("errors", "Erreurs techniques", "Coût", "errors", "n", "down"),
    ],  # fmt: skip
    "kb": [
        ("conform", "Questions conformes", "Recherche", "conform", "rate", "up"),
        (
            "relevant_min",
            "Score min. des bonnes réponses",
            "Recherche",
            "relevant_score_min",
            "n",
            "up",
        ),
        ("off_topic_max", "Score max. hors sujet", "Recherche", "off_topic_score_max", "n", "down"),
        (
            "same_topic_retained",
            "Même sujet retenus (l'agent transfère)",
            "Recherche",
            "same_topic_retained",
            "n",
            None,
        ),
        ("min_score", "Seuil utilisé", "Recherche", "min_score", "n", None),
    ],  # fmt: skip
}


def indicators(suite: str, summary: dict[str, Any]) -> list[dict[str, Any]]:
    """Indicateurs d'un passage, les mêmes pour un passage lancé et un rapport importé : une
    valeur absente (rapport plus ancien) vaut None et s'affiche « n/a »."""
    out = []
    for key, label, group, path, kind, better in _INDICATORS.get(suite, []):
        if kind == "rate":
            value, shown = _rate(summary, path)
        else:
            value, shown = _number(summary, path, "" if kind == "n" else kind)
        out.append(
            {
                "key": key,
                "label": label,
                "group": group,
                "value": value,
                "display": shown,
                "better": better,
                "kind": "rate" if kind == "rate" else "number",
            }
        )
    return out


# --- Enregistrement ---


def _now() -> datetime:
    return datetime.now(UTC)


def _public(doc: dict[str, Any], *, full: bool) -> dict[str, Any]:
    out = {k: v for k, v in doc.items() if k != "_id" and (full or k != "report")}
    out["id"] = doc["_id"]
    out["suite_label"] = SUITE_LABELS.get(doc.get("suite", ""), doc.get("suite"))
    if _ACTIVE is not None and _ACTIVE.run_id == doc["_id"] and not _ACTIVE.task.done():
        out["progress"] = _ACTIVE.progress()
    return out


async def mark_interrupted(db: Any) -> None:
    """Un passage « en cours » sans tâche dans ce processus a été coupé (redémarrage de l'API)."""
    active = _ACTIVE.run_id if _ACTIVE is not None and not _ACTIVE.task.done() else None
    query: dict[str, Any] = {"status": "running"}
    if active is not None:
        query["_id"] = {"$ne": active}
    await db[COLLECTION].update_many(
        query, {"$set": {"status": "interrupted", "finished_at": _now()}}
    )


async def list_runs(db: Any, *, limit: int = 200) -> list[dict[str, Any]]:
    await mark_interrupted(db)
    cursor = db[COLLECTION].find({}, {"report": 0}).sort("ran_at", -1).limit(limit)
    return [_public(doc, full=False) async for doc in cursor]


async def get_run(db: Any, run_id: str) -> dict[str, Any] | None:
    doc = await db[COLLECTION].find_one({"_id": run_id})
    return _public(doc, full=True) if doc else None


async def update_run(db: Any, run_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {k: v for k, v in changes.items() if k in ("label", "notes", "ran_at")}
    if allowed:
        await db[COLLECTION].update_one({"_id": run_id}, {"$set": allowed})
    return await get_run(db, run_id)


async def delete_run(db: Any, run_id: str) -> bool:
    if _ACTIVE is not None and _ACTIVE.run_id == run_id and not _ACTIVE.task.done():
        raise RunInProgress("Passage en cours : annulez-le avant de le supprimer.")
    result = await db[COLLECTION].delete_one({"_id": run_id})
    return bool(result.deleted_count)


# --- Import des rapports de la ligne de commande ---


def _detect_suite(report: dict[str, Any]) -> str:
    if not isinstance(report.get("summary"), dict):
        raise EvaluationError("Rapport non reconnu : résumé (« summary ») absent.")
    for key, suite in (("cases", "agent"), ("conversations", "conversations"), ("questions", "kb")):
        if isinstance(report.get(key), list):
            return suite
    raise EvaluationError(
        "Rapport non reconnu : il faut le JSON de eval-agent, eval-conversations ou kb-eval."
    )


def _complete_conversations(rows: list[dict[str, Any]]) -> None:
    """Rapports plus anciens : titre et échange reconstitués à partir des conversations écrites
    (messages du prospect) et des réponses enregistrées."""
    known = {c.id: c for c in conversation_eval.load_conversations()}
    for row in rows:
        conv = known.get(str(row.get("id")))
        if conv is None:
            continue
        row.setdefault("title", conv.title)
        if "transcript" not in row:
            transcript = []
            for i, turn in enumerate(row.get("turns") or []):
                if i < len(conv.turns):
                    transcript.append({"role": "prospect", "text": conv.turns[i].says})
                if turn.get("reply"):
                    transcript.append({"role": "agent", "text": turn["reply"]})
            row["transcript"] = transcript


def _complete_cases(rows: list[dict[str, Any]]) -> None:
    known = {c.id: c for c in evaluation.load_cases()}
    for row in rows:
        case = known.get(str(row.get("id")))
        if case is not None and "message" not in row:
            row["message"] = case.message


async def import_report(
    db: Any,
    report: dict[str, Any],
    *,
    label: str,
    ran_at: datetime | None,
    notes: str,
    file_name: str | None,
    user_id: int,
) -> dict[str, Any]:
    if len(json.dumps(report, ensure_ascii=False)) > MAX_IMPORT_BYTES:
        raise EvaluationError("Rapport trop volumineux.")
    suite = _detect_suite(report)
    if suite == "conversations":
        _complete_conversations(report["conversations"])
    elif suite == "agent":
        _complete_cases(report["cases"])
    meta: dict[str, Any] = report["meta"] if isinstance(report.get("meta"), dict) else {}
    now = _now()
    doc: dict[str, Any] = {
        "_id": uuid.uuid4().hex,
        "suite": suite,
        "label": label,
        "notes": notes,
        "source": "import",
        "file_name": file_name,
        "status": "done",
        "settings": {},
        "model": meta.get("model"),
        "mode": meta.get("mode"),
        "created_by": user_id,
        "created_at": now,
        "ran_at": ran_at or now,
        "indicators": indicators(suite, report["summary"]),
        "report": report,
    }
    await db[COLLECTION].insert_one(doc)
    return _public(doc, full=False)


# --- Exécution en tâche de fond ---


@dataclass
class _Active:
    run_id: str
    task: "asyncio.Task[None]"
    total: int
    done: int = 0
    ok: int = 0
    current: str | None = None

    def progress(self) -> dict[str, Any]:
        return {"done": self.done, "total": self.total, "ok": self.ok}


_ACTIVE: _Active | None = None


def _select(run: RunSettings) -> list[Any]:
    try:
        if run.suite == "agent":
            items: list[Any] = evaluation.load_cases(run.ids or None, run.categories or None)
        elif run.suite == "conversations":
            items = conversation_eval.load_conversations(run.ids or None)
        else:
            items = kb_evaluation.load_cases()
            if run.ids:
                wanted = {int(i) for i in run.ids if i.isdigit()}
                items = [c for i, c in enumerate(items) if i in wanted]
    except KeyError as exc:
        raise EvaluationError(str(exc.args[0])) from exc
    if not items:
        raise EvaluationError("Aucun cas ne correspond à ces réglages.")
    return items


async def start(
    db: Any,
    session_factory: async_sessionmaker[AsyncSession],
    run: RunSettings,
    *,
    app_settings: Settings,
    llm: LanguageModel,
    embeddings: EmbeddingModel | None,
    user_id: int,
) -> dict[str, Any]:
    """Enregistre le passage et le lance en tâche de fond ; rend la main tout de suite."""
    global _ACTIVE
    if app_settings.environment == "production":
        raise EvaluationError("Évaluation refusée en production.")
    if _ACTIVE is not None and not _ACTIVE.task.done():
        raise RunInProgress("Un passage est déjà en cours : attendez la fin ou annulez-le.")
    items = _select(run)
    if run.suite == "kb":
        if embeddings is None:
            raise EvaluationError("Embeddings indisponibles : clé absente (GEMINI_API_KEY).")
        model_name: str | None = embeddings.model_id
    elif run.live:
        if isinstance(llm, NullLanguageModel):
            raise EvaluationError("Aucun vrai modèle utilisable : vérifiez la clé et le modèle.")
        model_name = f"{llm.provider}/{llm.model}"
    else:
        model_name = "faux modèle scripté"
    await mark_interrupted(db)
    now = _now()
    doc: dict[str, Any] = {
        "_id": uuid.uuid4().hex,
        "suite": run.suite,
        "label": run.label,
        "notes": run.notes,
        "source": "app",
        "status": "running",
        "settings": run.effective(),
        "model": model_name,
        "created_by": user_id,
        "created_at": now,
        "started_at": now,
        "ran_at": now,
        "indicators": [],
    }
    await db[COLLECTION].insert_one(doc)
    task = asyncio.create_task(
        _execute(db, session_factory, run, doc["_id"], items, app_settings, llm, embeddings),
        name=f"evaluation-{doc['_id']}",
    )
    _ACTIVE = _Active(doc["_id"], task, total=len(items))
    return _public(doc, full=False)


async def cancel(db: Any, run_id: str) -> bool:
    if _ACTIVE is None or _ACTIVE.run_id != run_id or _ACTIVE.task.done():
        return False
    _ACTIVE.task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _ACTIVE.task
    return True


async def _knowledge_for(
    run: RunSettings,
    app_settings: Settings,
    session_factory: async_sessionmaker[AsyncSession],
) -> tuple[KnowledgeBase, str]:
    if not run.real_rag:
        return evaluation.LexicalKnowledge(), "base FICTIVE de démonstration, recherche lexicale"
    kb = create_knowledge_base(app_settings, session_factory)
    if kb is None:
        return EmptyKnowledgeBase(), "RAG désactivé (clé d'embeddings absente)"
    return kb, "recherche réelle (documents de démonstration chargés par seed-demo)"


async def _execute(
    db: Any,
    session_factory: async_sessionmaker[AsyncSession],
    run: RunSettings,
    run_id: str,
    items: list[Any],
    app_settings: Settings,
    llm: LanguageModel,
    embeddings: EmbeddingModel | None,
) -> None:
    started = time.perf_counter()
    collected: list[Any] = []

    def done(result: Any, ok: bool | None) -> None:
        collected.append(result)
        if _ACTIVE is not None and _ACTIVE.run_id == run_id:
            _ACTIVE.done += 1
            _ACTIVE.ok += bool(ok)

    build: Callable[[], dict[str, Any]] = dict
    status = "done"
    error: str | None = None
    try:
        if run.suite == "kb":
            assert embeddings is not None
            min_score = run.min_score if run.min_score is not None else app_settings.rag_min_score
            pg = PgKnowledgeBase(
                session_factory, embeddings, min_score=min_score, include_demo=True
            )
            async with session_factory() as session:
                slugs = {d.title: d.slug for d in await knowledge.list_documents(session)}

            def build_kb() -> dict[str, Any]:
                summary = kb_evaluation.summarize(collected, min_score)
                return kb_evaluation.to_payload(collected, summary, model=embeddings.model_id)

            build = build_kb
            await kb_evaluation.run(pg, slugs, items, on_done=lambda r: done(r, r.ok))
        else:
            model: LanguageModel = llm if run.live else FakeLLM()
            kb, kb_label = await _knowledge_for(run, app_settings, session_factory)
            mode = (
                f"réel ({llm.provider}/{llm.model})"
                if run.live
                else "hors ligne (faux modèle scripté)"
            )
            meta = {"mode": mode, "model": f"{model.provider}/{model.model}", "knowledge": kb_label}
            if run.suite == "agent":

                def build_agent() -> dict[str, Any]:
                    summary = evaluation.summarize(
                        collected, price_in=run.price_in, price_out=run.price_out
                    )
                    return evaluation.to_payload(collected, summary, ablation=run.ablation, **meta)

                build = build_agent
                await evaluation.run_eval(
                    session_factory, db, items, llm=model, knowledge=kb, ablation=run.ablation,
                    pause=run.pause, on_done=lambda r: done(r, r.ok),
                )  # fmt: skip
            else:

                def build_conversations() -> dict[str, Any]:
                    summary = conversation_eval.summarize(collected)
                    return conversation_eval.to_payload(collected, summary, **meta)

                build = build_conversations
                await conversation_eval.run_conversations(
                    session_factory, db, items, llm=model, knowledge=kb, pause=run.pause,
                    on_done=lambda r: done(r, r.ok),
                )  # fmt: skip
    except asyncio.CancelledError:
        status = "cancelled"
    except Exception as exc:  # rapporté sur la page, jamais silencieux
        logger.exception("Passage d'évaluation %s en échec", run_id)
        status, error = "failed", f"{type(exc).__name__} : {str(exc)[:500]}"
    finally:
        await _finish(db, session_factory, run, run_id, status, error, build, started)


async def _finish(
    db: Any,
    session_factory: async_sessionmaker[AsyncSession],
    run: RunSettings,
    run_id: str,
    status: str,
    error: str | None,
    build: Callable[[], dict[str, Any]],
    started: float,
) -> None:
    try:
        report = build()  # annulé ou en échec : les résultats déjà obtenus sont gardés
    except Exception:
        logger.exception("Rapport du passage %s impossible", run_id)
        report = {}
    changes: dict[str, Any] = {
        "status": status,
        "error": error,
        "finished_at": _now(),
        "duration_seconds": round(time.perf_counter() - started, 1),
    }
    if report:
        changes |= {"report": report, "indicators": indicators(run.suite, report["summary"])}
        if _ACTIVE is not None and _ACTIVE.run_id == run_id:
            changes["progress"] = _ACTIVE.progress()
    if run.suite != "kb" and run.cleanup:
        from app.devtools.commands import cleanup_recette

        try:
            async with session_factory() as session:
                changes["cleaned_up"] = await cleanup_recette(session, db)
        except Exception:
            logger.exception("Nettoyage des prospects de recette impossible")
    await db[COLLECTION].update_one({"_id": run_id}, {"$set": changes})
