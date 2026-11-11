"""Analyses (Pilotage) : délais de première réponse, devenir des brouillons, motifs de refus,
couverture de la base de connaissances, conversion par étape.

Toutes les mesures portent sur la période demandée et excluent les prospects fictifs
(@demo.example.com). Une mesure sans donnée vaut None : rien n'est estimé."""

import statistics
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runtime import RUNS
from app.models import Prospect
from app.models.enums import SenderType
from app.schemas.analytics import Analytics, Coverage, Delay, DraftOutcomes, RejectReason
from app.services import conversations, dashboard
from app.services.demo import demo_filter

MAX_REASONS = 10


def _aware(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _delay(values: list[float]) -> Delay:
    return Delay(median_seconds=statistics.median(values) if values else None, count=len(values))


async def _demo_ids(session: AsyncSession) -> list[int]:
    return list(await session.scalars(select(Prospect.id).where(demo_filter())))


async def analytics(session: AsyncSession, db: Any, days: int) -> Analytics:
    since = datetime.now(UTC) - timedelta(days=days)
    demo_ids = await _demo_ids(session)
    query: dict[str, Any] = {"messages.created_at": {"$gte": since}}
    if demo_ids:
        query["prospect_id"] = {"$nin": demo_ids}

    sent_delays: list[float] = []
    drafted_delays: list[float] = []
    confidences: list[float] = []
    outcomes = dict.fromkeys(
        ("generated", "approved_unchanged", "approved_edited", "rejected", "superseded", "pending"),
        0,
    )
    reasons: dict[str, RejectReason] = {}
    agent = SenderType.AGENT.value

    async for doc in db[conversations.COLLECTION].find(query):
        dated = sorted(
            ((at, m) for m in doc.get("messages", []) if (at := _aware(m.get("created_at")))),
            key=lambda pair: pair[0],
        )
        start = next((at for at, m in dated if m.get("role") == SenderType.PROSPECT.value), None)
        # Délais : conversations dont le premier message du prospect tombe dans la période.
        if start is not None and start >= since:
            replies = [(at, m) for at, m in dated if m.get("role") == agent and at >= start]
            if replies:
                drafted_delays.append((replies[0][0] - start).total_seconds())
            sent_at = [
                at
                for _, m in replies
                if (m.get("metadata") or {}).get("delivery") == "sent"
                and (at := _aware(((m.get("metadata") or {}).get("delivery_info") or {}).get("at")))
                and at >= start
            ]
            if sent_at:
                sent_delays.append((min(sent_at) - start).total_seconds())
        # Brouillons rédigés dans la période.
        for at, m in dated:
            meta = m.get("metadata") or {}
            draft = meta.get("draft")
            if m.get("role") != agent or not draft or at < since:
                continue
            outcomes["generated"] += 1
            status = draft.get("status")
            if status == "approved":
                outcomes["approved_edited" if draft.get("edited") else "approved_unchanged"] += 1
            elif status in ("rejected", "superseded", "pending"):
                outcomes[status] += 1
            confidence = meta.get("confidence")
            if isinstance(confidence, (int, float)) and not isinstance(confidence, bool):
                confidences.append(float(confidence))
            text = (draft.get("reason") or "").strip() if status == "rejected" else ""
            if text:
                key = " ".join(text.lower().split())
                item = reasons.setdefault(key, RejectReason(reason=text, count=0))
                item.count += 1

    # Couverture : questions lues par l'agent et réponses bloquées faute d'extrait validé.
    run_query: dict[str, Any] = {"started_at": {"$gte": since}, "status": "completed"}
    if demo_ids:
        run_query["prospect_id"] = {"$nin": demo_ids}
    questions = unanswered = 0
    async for run in db[RUNS].find(run_query):
        trace = run.get("trace", [])
        qualify = next((t for t in trace if t.get("node") == "qualify_prospect"), None)
        if qualify and "intention question" in qualify.get("summary", ""):
            questions += 1
            unanswered += run.get("handoff_reason") == "question_hors_base"

    overview = await dashboard.overview(session, days)
    return Analytics(
        days=days,
        since=since,
        first_reply_sent=_delay(sent_delays),
        first_reply_drafted=_delay(drafted_delays),
        average_confidence=statistics.fmean(confidences) if confidences else None,
        drafts=DraftOutcomes(**outcomes),
        reject_reasons=sorted(reasons.values(), key=lambda r: (-r.count, r.reason))[:MAX_REASONS],
        coverage=Coverage(questions=questions, answered=questions - unanswered),
        funnel=overview.funnel,
    )
