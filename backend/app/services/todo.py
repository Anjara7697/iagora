"""« À traiter » : ce qui attend un conseiller (brouillons à valider, transferts, incidents).

Les priorités sont des valeurs de conception (à valider avec les conseillers) :
- situation sensible : critique ;
- demande d'un conseiller : critique si le prospect est chaud, sinon élevée ;
- incident technique (modèle, agenda, réponse non vérifiable) : élevée ;
- lacune de la base de connaissances : élevée si le prospect est chaud, sinon moyenne ;
- brouillon à valider : élevée, moyenne ou faible selon que le prospect est chaud, tiède ou froid.
"""

from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runtime import RUNS
from app.schemas.conversation import ConversationProspect
from app.schemas.todo import (
    Priority,
    TodoDraft,
    TodoItem,
    TodoKind,
    TodoPage,
    TodoRecommendation,
)
from app.services import drafts, inbox

MAX_SCANNED = 500
INCIDENT_REASONS = {
    "llm_indisponible",
    "agenda_indisponible",
    "aucun_creneau",
    "reservation_impossible",
    "reponse_non_verifiable",
}
HOT = {"hot", "very_hot"}
_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _aware(value: Any) -> datetime | None:
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value if isinstance(value, datetime) else None


def handoff_kind(reason: str | None) -> TodoKind:
    if reason == "question_hors_base":
        return "kb_gap"
    if reason in INCIDENT_REASONS:
        return "incident"
    return "escalation"


def handoff_priority(kind: TodoKind, reason: str | None, level: str | None) -> Priority:
    if reason == "situation_sensible":
        return "critical"
    if kind == "incident":
        return "high"
    if kind == "kb_gap":
        return "high" if level in HOT else "medium"
    return "critical" if level in HOT else "high"


def draft_priority(level: str | None) -> Priority:
    if level in HOT:
        return "high"
    return "medium" if level == "warm" else "low"


def draft_risk(draft_meta: dict[str, Any], sources: list[str]) -> Literal["low", "medium", "high"]:
    """Faible si la réponse s'appuie sur des extraits validés, moyen sinon ; élevé si peu fiable."""
    confidence = draft_meta.get("confidence")
    if isinstance(confidence, (int, float)) and confidence < 0.6:
        return "high"
    return "low" if sources else "medium"


_HANDOFF_TITLES = {
    "kb_gap": "Lacune de la base de connaissances",
    "incident": "Incident : l'agent n'a pas pu répondre",
    "escalation": "Escalade : intervention d'un conseiller",
}


async def list_todo(
    session: AsyncSession,
    db: Any,
    *,
    kind: str | None,
    limit: int,
    offset: int,
) -> TodoPage:
    match = {
        "$or": [
            {"status": "handed_off"},
            {"status": "open", "messages.metadata.draft.status": drafts.PENDING},
        ]
    }
    docs = [
        d
        async for d in db["conversations"]
        .find(match)
        .sort([("last_message_at", -1)])
        .limit(MAX_SCANNED)
    ]
    cards = await inbox.prospect_cards(session, [int(d["prospect_id"]) for d in docs])
    items: list[TodoItem] = []
    for doc in docs:
        card: ConversationProspect | None = cards.get(int(doc["prospect_id"]))
        level = card.level if card else None
        conv_id = str(doc["_id"])
        for message in doc.get("messages", []):
            if not drafts.is_pending(message):
                continue
            meta = message.get("metadata", {})
            sources = [str(s) for s in meta.get("sources", [])]
            run = await db[RUNS].find_one({"conversation_id": conv_id}, sort=[("started_at", -1)])
            confidence = meta.get("confidence")
            items.append(
                TodoItem(
                    id=f"draft:{conv_id}:{message['id']}",
                    kind="validation",
                    priority=draft_priority(level),
                    conversation_id=conv_id,
                    prospect=card,
                    channel=doc["channel"],
                    title="Brouillon de réponse à valider",
                    detail=_last_prospect_text(doc),
                    created_at=_aware(message.get("created_at")),
                    draft=TodoDraft(
                        message_id=message["id"],
                        content=message["content"],
                        sources=sources,
                        confidence=confidence,
                        created_at=_aware(message["created_at"]) or datetime.now(UTC),
                    ),
                    recommendation=TodoRecommendation(
                        action="Valider ou modifier la réponse de l'agent",
                        reason=(run or {}).get("reason"),
                        risk=draft_risk(meta, sources),
                        confidence=confidence,
                        sources=sources,
                    ),
                )
            )
        if doc["status"] == "handed_off":
            sheet = doc.get("handoff") or {}
            reason = sheet.get("reason")
            kind_ = handoff_kind(reason)
            items.append(
                TodoItem(
                    id=f"handoff:{conv_id}",
                    kind=kind_,
                    priority=handoff_priority(kind_, reason, level),
                    conversation_id=conv_id,
                    prospect=card,
                    channel=doc["channel"],
                    title=_HANDOFF_TITLES[kind_],
                    detail=sheet.get("pending_question") or sheet.get("summary"),
                    created_at=_aware(doc.get("last_message_at")),
                    handoff=sheet or None,
                    recommendation=(
                        TodoRecommendation(
                            action=sheet["recommended_action"],
                            reason=sheet.get("summary"),
                            risk="high" if reason == "situation_sensible" else "medium",
                        )
                        if sheet.get("recommended_action")
                        else None
                    ),
                )
            )
    counts: dict[str, int] = {}
    for item in items:
        counts[item.kind] = counts.get(item.kind, 0) + 1
    selected = [i for i in items if kind in (None, "", i.kind)]
    selected.sort(
        key=lambda i: (
            _ORDER[i.priority],
            -(i.created_at.timestamp() if i.created_at else 0.0),
        )
    )
    return TodoPage(
        items=selected[offset : offset + limit],
        total=len(selected),
        limit=limit,
        offset=offset,
        counts=counts,
    )


def _last_prospect_text(doc: dict[str, Any]) -> str | None:
    for message in reversed(drafts.live_messages(doc.get("messages", []))):
        if message["role"] == "prospect":
            return str(message["content"])
    return None
