"""Synthèse du tableau de bord « Aujourd'hui » : signaux forts, activité de l'agent, relances,
entonnoir. Les prospects fictifs (@demo.example.com) sont exclus des chiffres."""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Campaign,
    CampaignProspect,
    CampaignSource,
    FollowUp,
    Prospect,
    Source,
    StageEvent,
    Target,
)
from app.models.enums import ConsentStatus, ConversionStage, FollowUpStatus
from app.schemas.dashboard import (
    AgentActivity,
    Breakdown,
    DashboardOverview,
    DashboardSummary,
    FunnelStep,
    HotProspect,
    ScheduledFollowUp,
)
from app.services import agent_settings, commercial_context, conversations
from app.services.demo import demo_filter

_DONE = (ConversionStage.LOST, ConversionStage.CONVERTED)


def _name(p: Prospect) -> str:
    full = " ".join(x for x in (p.first_name, p.last_name) if x)
    return full or p.email or f"Prospect {p.id}"


async def hot_prospects(session: AsyncSession, limit: int = 5) -> list[HotProspect]:
    rows = await session.execute(
        select(Prospect, CampaignProspect, Campaign.id, Campaign.name)
        .join(CampaignProspect, CampaignProspect.prospect_id == Prospect.id)
        .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
        .join(Campaign, Campaign.id == CampaignSource.campaign_id)
        .where(
            ~demo_filter(),
            Prospect.consent_status != ConsentStatus.OPTED_OUT,
            CampaignProspect.conversion_stage.notin_(_DONE),
            CampaignProspect.total_score > 0,
        )
        .order_by(CampaignProspect.total_score.desc(), CampaignProspect.id)
        .limit(limit * 3)
    )
    seen: set[int] = set()
    out: list[HotProspect] = []
    for prospect, member, campaign_id, campaign_name in rows:
        if prospect.id in seen:
            continue  # un prospect dans plusieurs campagnes : on garde son meilleur score
        seen.add(prospect.id)
        out.append(
            HotProspect(
                id=prospect.id,
                name=_name(prospect),
                email=prospect.email,
                stage=member.conversion_stage.value,
                level=member.interest_status.value if member.interest_status else None,
                total_score=member.total_score,
                campaign_id=campaign_id,
                campaign_name=campaign_name,
            )
        )
        if len(out) == limit:
            break
    return out


async def agent_activity(session: AsyncSession, db: Any, hours: int = 24) -> AgentActivity:
    since = datetime.now(UTC) - timedelta(hours=hours)
    demo_ids = list(await session.scalars(select(Prospect.id).where(demo_filter())))
    base: dict[str, Any] = {"started_at": {"$gte": since}}
    if demo_ids:
        base["prospect_id"] = {"$nin": demo_ids}
    runs = await db["agent_runs"].find(base).to_list(None)
    analysed = {r["prospect_id"] for r in runs if r.get("status") == "completed"}
    escalations = sum(1 for r in runs if r.get("handoff_reason"))
    errors = sum(1 for r in runs if r.get("status") == "error")

    match: dict[str, Any] = {"messages.created_at": {"$gte": since}, "messages.role": "agent"}
    if demo_ids:
        match["prospect_id"] = {"$nin": demo_ids}
    drafts = sent_validated = sent_direct = 0
    async for doc in db[conversations.COLLECTION].find(match):
        for m in doc.get("messages", []):
            created = m.get("created_at")
            if m.get("role") != "agent" or created is None:
                continue
            if created.tzinfo is None:
                created = created.replace(tzinfo=UTC)
            meta = m.get("metadata") or {}
            if created >= since and meta.get("draft"):
                drafts += 1
            if meta.get("delivery") == "sent":
                if meta.get("draft", {}).get("status") == "approved":
                    sent_validated += 1
                else:
                    sent_direct += 1
    return AgentActivity(
        hours=hours,
        prospects_analysed=len(analysed),
        drafts_generated=drafts,
        sent_after_validation=sent_validated,
        sent_without_validation=sent_direct,
        escalations=escalations,
        errors=errors,
    )


async def scheduled_follow_ups(
    session: AsyncSession, limit: int = 5
) -> tuple[list[ScheduledFollowUp], int]:
    where = (
        FollowUp.status == FollowUpStatus.SCHEDULED,
        ~demo_filter(),
    )
    total = (
        await session.scalar(
            select(func.count())
            .select_from(FollowUp)
            .join(Prospect, Prospect.id == FollowUp.prospect_id)
            .where(*where)
        )
        or 0
    )
    rows = await session.execute(
        select(FollowUp, Prospect)
        .join(Prospect, Prospect.id == FollowUp.prospect_id)
        .where(*where)
        .order_by(FollowUp.scheduled_at)
        .limit(limit)
    )
    items = [
        ScheduledFollowUp(
            id=f.id,
            prospect_id=p.id,
            prospect_name=_name(p),
            scheduled_at=f.scheduled_at,
            reason=f.reason,
        )
        for f, p in rows
    ]
    return items, int(total)


async def funnel(session: AsyncSession, days: int = 30) -> tuple[dict[str, int], int]:
    since = datetime.now(UTC) - timedelta(days=days)
    rows = await session.execute(
        select(CampaignProspect.conversion_stage, func.count())
        .join(Prospect, Prospect.id == CampaignProspect.prospect_id)
        .where(
            CampaignProspect.first_seen_at >= since,
            ~demo_filter(),
            CampaignProspect.id.in_(commercial_context.latest_ids()),
        )
        .group_by(CampaignProspect.conversion_stage)
    )
    by_stage = {stage.value: int(n) for stage, n in rows}
    return by_stage, sum(by_stage.values())


async def summary(session: AsyncSession, db: Any) -> DashboardSummary:
    follow_ups, follow_ups_total = await scheduled_follow_ups(session)
    by_stage, leads = await funnel(session)
    return DashboardSummary(
        agent_mode=(await agent_settings.get_mode(db)).value,
        hot_prospects=await hot_prospects(session),
        activity=await agent_activity(session, db),
        follow_ups=follow_ups,
        follow_ups_total=follow_ups_total,
        funnel_days=30,
        funnel=by_stage,
        leads=leads,
    )


# --- Tableau de bord (Pilotage) ---

# Rang de progression : « à relancer » et « perdu » ne font pas avancer dans l'entonnoir.
_RANK = {
    ConversionStage.QUALIFIED: 1,
    ConversionStage.MEETING_PROPOSED: 1,
    ConversionStage.MEETING_SCHEDULED: 2,
    ConversionStage.MEETING_DONE: 2,
    ConversionStage.APPLIED: 3,
    ConversionStage.CONVERTED: 4,
}
FUNNEL_STEPS = (
    ("leads", "Leads reçus", 0),
    ("qualified", "Qualifiés", 1),
    ("meeting", "Rendez-vous planifiés", 2),
    ("applied", "Candidatures", 3),
    ("converted", "Inscrits", 4),
)
NOT_SET = "Non renseigné"


async def overview(session: AsyncSession, days: int) -> DashboardOverview:
    """Prospects arrivés dans la période (rattachement le plus récent de chacun), avec l'étape la
    plus avancée qu'ils ont atteinte et leur répartition par programme et par source."""
    since = datetime.now(UTC) - timedelta(days=days)
    rows = (
        await session.execute(
            select(
                CampaignProspect.id,
                CampaignProspect.conversion_stage,
                Target.code,
                Target.name,
                Source.id,
                Source.name,
            )
            .join(Prospect, Prospect.id == CampaignProspect.prospect_id)
            .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
            .join(Source, Source.id == CampaignSource.source_id)
            .outerjoin(Target, Target.id == Prospect.target_id)
            .where(
                CampaignProspect.first_seen_at >= since,
                ~demo_filter(),
                CampaignProspect.id.in_(commercial_context.latest_ids()),
            )
        )
    ).all()
    reached: dict[int, int] = {r[0]: _RANK.get(r[1], 0) for r in rows}
    if reached:
        history = await session.execute(
            select(StageEvent.campaign_prospect_id, StageEvent.to_stage).where(
                StageEvent.campaign_prospect_id.in_(list(reached))
            )
        )
        for mid, stage in history:
            reached[mid] = max(reached[mid], _RANK.get(stage, 0))

    targets: dict[str | None, Breakdown] = {}
    sources: dict[str | None, Breakdown] = {}
    for _, _, t_code, t_name, s_id, s_name in rows:
        t = targets.setdefault(t_code, Breakdown(key=t_code, label=t_name or NOT_SET, count=0))
        t.count += 1
        key = str(s_id) if s_id is not None else None
        src = sources.setdefault(key, Breakdown(key=key, label=s_name or NOT_SET, count=0))
        src.count += 1

    def ordered(items: dict[str | None, Breakdown]) -> list[Breakdown]:
        return sorted(items.values(), key=lambda b: (-b.count, b.label))

    return DashboardOverview(
        days=days,
        since=since,
        leads=len(rows),
        funnel=[
            FunnelStep(key=key, label=text, count=sum(1 for r in reached.values() if r >= rank))
            for key, text, rank in FUNNEL_STEPS
        ],
        by_target=ordered(targets),
        by_source=ordered(sources),
    )
