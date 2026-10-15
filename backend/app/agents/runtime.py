"""Exécution du workflow : prépare le contexte, lance le graphe, journalise la décision (NF-04)."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import DESCENDING
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.defaults import RecordingMessenger
from app.agents.gateway import DbGateway
from app.graph.builder import build_workflow
from app.graph.ports import Calendar, Deps, KnowledgeBase, LanguageModel
from app.graph.state import SalesAgentState
from app.models import Channel
from app.models.enums import ConversationStatus, SenderType
from app.schemas.agent import AgentRunResult, TraceRead
from app.schemas.conversation import ConversationCreate
from app.services import agent_settings, conversations, drafts
from app.services.agent_settings import AgentMode
from app.services.errors import ConflictError, NotFoundError
from app.services.prospects import get_prospect

logger = logging.getLogger(__name__)
RUNS = "agent_runs"


async def ensure_run_indexes(db: Any) -> None:
    await db[RUNS].create_index([("prospect_id", 1), ("started_at", DESCENDING)])


async def _resolve_conversation(
    session: AsyncSession,
    db: Any,
    conversation_id: str | None,
    prospect_id: int | None,
    channel: str | None,
) -> dict[str, Any]:
    if conversation_id is not None:
        return await conversations.get_doc(db, conversation_id)
    assert prospect_id is not None  # noqa: S101 - garanti par AgentRunRequest
    prospect = await get_prospect(session, prospect_id)
    channel_name = channel
    if channel_name is None:
        for channel_id in (prospect.current_channel_id, prospect.origin_channel_id):
            if channel_id is not None:
                found = await session.get(Channel, channel_id)
                channel_name = found.name if found else None
                break
    read, _ = await conversations.create_conversation(
        session, db, ConversationCreate(prospect_id=prospect_id, channel=channel_name or "email")
    )
    return await conversations.get_doc(db, read.id)


_locks: dict[str, asyncio.Lock] = {}


async def run_agent(
    session: AsyncSession,
    db: Any,
    *,
    conversation_id: str | None = None,
    **kwargs: Any,
) -> AgentRunResult:
    """Exécute l'agent. Les exécutions d'une même conversation sont sérialisées : un déclenchement
    automatique et un déclenchement manuel simultanés ne produisent jamais deux réponses (la seconde
    exécution voit que l'agent a déjà répondu et s'arrête avec un conflit)."""
    if conversation_id is None:
        return await _run_agent(session, db, **kwargs)
    async with _locks.setdefault(conversation_id, asyncio.Lock()):
        return await _run_agent(session, db, conversation_id=conversation_id, **kwargs)


async def _run_agent(
    session: AsyncSession,
    db: Any,
    *,
    llm: LanguageModel,
    calendar: Calendar,
    knowledge: KnowledgeBase,
    conversation_id: str | None = None,
    prospect_id: int | None = None,
    channel: str | None = None,
    mode: AgentMode | None = None,
    follow_up: bool = False,
) -> AgentRunResult:
    """`mode` : à fournir pour ignorer le réglage global (recette hors ligne, tests).
    `follow_up` : relance d'un prospect resté silencieux (dernier message : celui de l'agent)."""
    started_at = datetime.now(UTC)
    doc = await _resolve_conversation(session, db, conversation_id, prospect_id, channel)
    conv_id = str(doc["_id"])
    pid = int(doc["prospect_id"])

    mode = mode or await agent_settings.get_mode(db)
    if mode is AgentMode.MANUAL:
        raise ConflictError("Agent en mode manuel (arrêt d'urgence) : aucune réponse automatique")
    if doc["status"] == ConversationStatus.CLOSED.value:
        raise ConflictError("La conversation est clôturée")
    if doc["status"] == ConversationStatus.HANDED_OFF.value:
        raise ConflictError("Conversation transférée à un conseiller : l'agent n'intervient plus")
    messages = drafts.live_messages(doc.get("messages", []))
    if follow_up:
        if not messages or drafts.is_pending(messages[-1]):
            raise ConflictError("Relance impossible : conversation vide ou brouillon en attente")
        if messages[-1]["role"] == SenderType.PROSPECT.value:
            raise ConflictError("Le prospect a répondu : plus de relance à faire")
        trigger, inbound_text = "follow_up", ""
    elif not messages:
        trigger, inbound_text = "first_contact", ""
    elif messages[-1]["role"] == SenderType.PROSPECT.value:
        trigger, inbound_text = "inbound_message", messages[-1]["content"]
    elif drafts.is_pending(messages[-1]):
        raise ConflictError("Un brouillon est en attente de validation")
    else:
        raise ConflictError("Aucun message du prospect à traiter")

    deps = Deps(
        llm=llm,
        gateway=DbGateway(session, db),
        messenger=RecordingMessenger(session, db, mode),
        calendar=calendar,
        knowledge=knowledge,
    )
    graph = build_workflow(deps)
    initial: SalesAgentState = {
        "prospect_id": pid,
        "conversation_id": conv_id,
        "trigger": trigger,  # type: ignore[typeddict-item]
        "inbound_text": inbound_text,
        "trace": [],
    }
    run_doc: dict[str, Any] = {
        "prospect_id": pid,
        "conversation_id": conv_id,
        "trigger": trigger,
        "started_at": started_at,
        "llm": {"provider": llm.provider, "model": llm.model},
    }
    try:
        state: SalesAgentState = await graph.ainvoke(initial)
    except Exception as exc:
        logger.exception("Exécution de l'agent en erreur (prospect %s)", pid)
        await db[RUNS].insert_one(
            {**run_doc, "status": "error", "error": f"{type(exc).__name__}: {exc}"}
        )
        raise

    decision = state["decision"]
    trace = state.get("trace", [])
    result_doc = {
        **run_doc,
        "status": "completed",
        "finished_at": datetime.now(UTC),
        "action": decision.action.value,
        "reason": decision.reason,
        "outcome": state.get("outcome", decision.action.value),
        "reply": state.get("reply_text"),
        "handoff_reason": state.get("handoff_reason") if state.get("needs_human") else None,
        "stage_before": state.get("stage_before"),
        "stage_after": state.get("stage_after"),
        "scores": {
            "interest": state.get("interest_score"),
            "fit": state.get("fit_score"),
            "total": state.get("total_score"),
            "level": state.get("interest_level"),
        },
        "trace": [{"node": t.node, "summary": t.summary, "at": t.at} for t in trace],
    }
    inserted = await db[RUNS].insert_one(result_doc)
    return to_result(result_doc, str(inserted.inserted_id))


def to_result(doc: dict[str, Any], run_id: str) -> AgentRunResult:
    return AgentRunResult(
        run_id=run_id,
        prospect_id=doc["prospect_id"],
        conversation_id=doc["conversation_id"],
        trigger=doc["trigger"],
        action=doc.get("action", "error"),
        reason=doc.get("reason", doc.get("error", "")),
        outcome=doc.get("outcome", doc.get("status", "")),
        reply=doc.get("reply"),
        handoff_reason=doc.get("handoff_reason"),
        stage_before=doc.get("stage_before"),
        stage_after=doc.get("stage_after"),
        scores=doc.get("scores", {}),
        llm=doc.get("llm", {}),
        trace=[TraceRead(**t) for t in doc.get("trace", [])],
        started_at=doc["started_at"],
    )


async def get_run(db: Any, run_id: str) -> AgentRunResult:
    try:
        oid = ObjectId(run_id)
    except (InvalidId, TypeError):
        raise NotFoundError(f"Exécution {run_id} introuvable") from None
    doc = await db[RUNS].find_one({"_id": oid})
    if doc is None:
        raise NotFoundError(f"Exécution {run_id} introuvable")
    return to_result(doc, run_id)


async def list_runs(
    session: AsyncSession, db: Any, prospect_id: int, limit: int = 20
) -> list[AgentRunResult]:
    await get_prospect(session, prospect_id)
    docs = (
        await db[RUNS]
        .find({"prospect_id": prospect_id})
        .sort("started_at", DESCENDING)
        .to_list(limit)
    )
    return [to_result(d, str(d["_id"])) for d in docs]
