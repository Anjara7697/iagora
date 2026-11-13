"""Premiers contacts d'une campagne, préparés par lot (prospection sortante, décision D-29).

Après l'import d'une liste (salon, webinaire, événement), un conseiller demande à l'agent d'écrire
le premier message à chaque personne de la campagne. Rien ne part directement :

- seules sont retenues les personnes dont le consentement est accordé, avec une adresse email, à
  l'étape « Nouveau » de cette campagne (leur contexte commercial courant) et jamais contactées ;
- chaque premier contact entre dans la file de l'agent (`agent_events`), traitée en tâche de fond ;
  en mode assisté, il devient un brouillon « Premier contact à valider » dans « À traiter » ;
- une fois validés, les envois sont étalés et limités à la fenêtre d'envoi (`email_sync`).
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.agent_mode import AgentMode
from app.models import Campaign, CampaignProspect, CampaignSource, Prospect
from app.models.enums import CampaignStatus, ConsentStatus, ConversionStage
from app.schemas.conversation import ConversationCreate
from app.services import agent_settings, commercial_context, conversations
from app.services.agent_events import enqueue_reply
from app.services.errors import ConflictError, NotFoundError

MAX_PER_REQUEST = 500


@dataclass
class FirstContactPlan:
    campaign_active: bool
    eligible: list[int]
    without_consent: int = 0
    without_email: int = 0
    already_contacted: int = 0
    in_progress: int = 0
    opted_out: int = 0
    queued: int = 0


async def plan(
    session: AsyncSession, db: Any, campaign_id: int, visible: list[int] | None
) -> FirstContactPlan:
    """Qui recevrait un premier contact maintenant.

    `visible` : périmètre d'un conseiller (D-23) ; None pour tout voir."""
    campaign = await session.get(Campaign, campaign_id)
    if campaign is None:
        raise NotFoundError("Campagne introuvable")
    stmt = (
        select(CampaignProspect, Prospect)
        .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
        .join(Prospect, Prospect.id == CampaignProspect.prospect_id)
        .where(
            CampaignSource.campaign_id == campaign_id,
            # Contexte commercial courant : l'agent écrirait au nom de cette campagne.
            CampaignProspect.id.in_(commercial_context.latest_ids()),
        )
        .order_by(CampaignProspect.id)
    )
    if visible is not None:
        stmt = stmt.where(Prospect.id.in_(visible))
    result = FirstContactPlan(campaign.status is CampaignStatus.ACTIVE, [])
    candidates: list[int] = []
    for membership, prospect in (await session.execute(stmt)).tuples():
        if prospect.consent_status is ConsentStatus.OPTED_OUT:
            result.opted_out += 1
        elif prospect.consent_status is not ConsentStatus.GRANTED:
            result.without_consent += 1
        elif not prospect.email:
            result.without_email += 1
        elif membership.conversion_stage is not ConversionStage.NEW:
            result.already_contacted += 1
        else:
            candidates.append(prospect.id)
    if not candidates:
        return result
    written = set(
        await db[conversations.COLLECTION].distinct(
            "prospect_id", {"prospect_id": {"$in": candidates}, "messages": {"$ne": []}}
        )
    )
    queued = set(
        await db["agent_events"].distinct(
            "prospect_id", {"prospect_id": {"$in": candidates}, "completed": False}
        )
    )
    for pid in candidates:
        if pid in queued:
            result.in_progress += 1
        elif pid in written:
            result.already_contacted += 1
        else:
            result.eligible.append(pid)
    return result


async def enqueue(
    session: AsyncSession, db: Any, campaign_id: int, visible: list[int] | None
) -> FirstContactPlan:
    """Met en file un premier contact pour chaque personne éligible (au plus 500 par demande)."""
    result = await plan(session, db, campaign_id, visible)
    if not result.campaign_active:
        raise ConflictError("Activez la campagne avant de préparer les premiers contacts")
    if await agent_settings.get_mode(db) is AgentMode.MANUAL:
        raise ConflictError("Agent en mode manuel (arrêt d'urgence) : aucun message n'est préparé")
    for pid in result.eligible[:MAX_PER_REQUEST]:
        conversation, _ = await conversations.create_conversation(
            session, db, ConversationCreate(prospect_id=pid, channel="email")
        )
        await enqueue_reply(db, conversation.id)
        result.queued += 1
    return result
