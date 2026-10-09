"""Passerelle entre le workflow et les données métier (PostgreSQL + MongoDB)."""

import dataclasses
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.graph.ports import (
    BookedMeeting,
    HandoffSheet,
    HistoryMessage,
    ProspectContext,
    ScoreChange,
    ScoreSnapshot,
    Slot,
)
from app.models import (
    Campaign,
    CampaignProspect,
    CampaignSource,
    Channel,
    Interaction,
    Source,
    Target,
)
from app.models.enums import (
    ConversationStatus,
    ConversionStage,
    Direction,
    ScoringSignal,
)
from app.schemas.appointment import AppointmentData
from app.schemas.conversation import ConversationUpdate
from app.services import appointments, conversations, follow_ups, pipeline, prospects, scoring
from app.services.errors import NotFoundError


def _pending_slots(messages: Sequence[dict[str, Any]]) -> list[Slot]:
    """Créneaux proposés au prospect et pas encore réservés (dernier message de l'agent)."""
    for message in reversed(messages):
        if message["role"] == "prospect":
            continue
        meta = message.get("metadata") or {}
        if meta.get("mode") == "meeting_confirmation":
            return []
        proposed = meta.get("proposed_slots")
        if proposed:
            return [
                Slot(
                    id=p["id"],
                    start=datetime.fromisoformat(p["start"]),
                    end=datetime.fromisoformat(p["end"]),
                )
                for p in proposed
            ]
    return []


class DbGateway:
    def __init__(self, session: AsyncSession, db: Any) -> None:
        self._session = session
        self._db = db

    async def load_context(self, prospect_id: int, conversation_id: str) -> ProspectContext:
        session = self._session
        prospect = await prospects.get_prospect(session, prospect_id)
        doc = await conversations.get_doc(self._db, conversation_id)
        if doc["prospect_id"] != prospect_id:
            raise NotFoundError("Cette conversation n'appartient pas à ce prospect")

        # Rattachement le plus récemment actif (un prospect peut être dans plusieurs campagnes).
        row = (
            await session.execute(
                select(CampaignProspect, Campaign.name, Source.name)
                .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
                .join(Campaign, Campaign.id == CampaignSource.campaign_id)
                .join(Source, Source.id == CampaignSource.source_id)
                .where(CampaignProspect.prospect_id == prospect_id)
                .order_by(CampaignProspect.last_seen_at.desc(), CampaignProspect.id.desc())
                .limit(1)
            )
        ).first()
        target_code = None
        if prospect.target_id is not None:
            target = await session.get(Target, prospect.target_id)
            target_code = target.code if target else None

        membership = row[0] if row else None
        messages = doc.get("messages", [])
        return ProspectContext(
            prospect_id=prospect_id,
            conversation_id=conversation_id,
            channel=doc["channel"],
            first_name=prospect.first_name,
            last_name=prospect.last_name,
            email=prospect.email,
            phone=prospect.phone,
            target_code=target_code,
            campaign_name=row[1] if row else None,
            source_name=row[2] if row else None,
            membership_id=membership.id if membership else None,
            stage=membership.conversion_stage if membership else None,
            interest_score=membership.interest_score if membership else 0,
            fit_score=membership.fit_score if membership else 0,
            total_score=membership.total_score if membership else 0,
            interest_level=membership.interest_status.value
            if membership and membership.interest_status
            else None,
            advisor_id=membership.assigned_advisor_id if membership else None,
            consent_status=prospect.consent_status.value,
            profile=dict(prospect.profile or {}),
            history=[
                HistoryMessage(
                    role=m["role"],
                    content=m["content"],
                    created_at=m.get("created_at"),
                    metadata=m.get("metadata") or {},
                )
                for m in messages
            ],
            pending_slots=_pending_slots(messages),
        )

    async def save_profile(self, prospect_id: int, updates: dict[str, Any]) -> None:
        prospect = await prospects.get_prospect(self._session, prospect_id)
        prospect.profile = {**(prospect.profile or {}), **updates}
        await self._session.commit()

    async def apply_signals(
        self, membership_id: int, signals: Sequence[ScoringSignal]
    ) -> ScoreSnapshot:
        changes: list[ScoreChange] = []
        membership = None
        for signal in signals:
            membership, events = await scoring.apply_signal(self._session, membership_id, signal)
            changes += [ScoreChange(e.score_type, e.points, e.new_value, e.reason) for e in events]
        if membership is None:
            membership = await pipeline.get_membership(self._session, membership_id)
        return ScoreSnapshot(
            interest=membership.interest_score,
            fit=membership.fit_score,
            total=membership.total_score,
            level=membership.interest_status.value if membership.interest_status else None,
            changes=changes,
        )

    async def change_stage(self, membership_id: int, stage: ConversionStage, reason: str) -> None:
        await pipeline.change_stage(self._session, membership_id, stage, reason)

    async def record_opt_out(self, prospect_id: int, channel: str, source: str) -> None:
        await prospects.opt_out(self._session, prospect_id, source, channel)

    async def schedule_follow_up(
        self,
        prospect_id: int,
        membership_id: int | None,
        channel: str,
        delay: timedelta,
        reason: str,
    ) -> None:
        await follow_ups.schedule_follow_up(
            self._session, prospect_id, membership_id, channel, delay, reason
        )

    async def save_handoff(self, conversation_id: str, sheet: HandoffSheet) -> None:
        await conversations.set_handoff(self._db, conversation_id, dataclasses.asdict(sheet))
        doc = await conversations.get_doc(self._db, conversation_id)
        channel = await self._session.scalar(select(Channel).where(Channel.name == doc["channel"]))
        # Trace dans le journal (F-20 : chaque transfert est tracé).
        self._session.add(
            Interaction(
                prospect_id=doc["prospect_id"],
                channel_id=channel.id if channel else None,
                type="human_handoff",
                direction=Direction.OUTBOUND,
                intent=sheet.reason,
                conversation_ref=conversation_id,
            )
        )
        await self._session.commit()

    async def close_conversation(self, conversation_id: str, summary: str | None) -> None:
        await conversations.update_conversation(
            self._db,
            conversation_id,
            ConversationUpdate(status=ConversationStatus.CLOSED, summary=summary),
        )

    async def create_appointment(
        self, prospect_id: int, advisor_id: int | None, meeting: BookedMeeting
    ) -> int:
        appointment = await appointments.create_appointment(
            self._session,
            prospect_id,
            advisor_id,
            AppointmentData(
                calendar_event_id=meeting.calendar_event_id,
                zoom_meeting_id=meeting.zoom_meeting_id,
                meeting_url=meeting.meeting_url,
                start_at=meeting.slot.start,
                end_at=meeting.slot.end,
            ),
        )
        return appointment.id
