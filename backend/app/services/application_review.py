"""Terminer une demande de vérification après confirmation humaine du bon parcours."""

from datetime import UTC, datetime
from typing import Any

from pymongo import ReturnDocument
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampaignProspect, User
from app.models.enums import ConversationStatus, ConversionStage
from app.schemas.conversation import ConversationRead
from app.services import conversations
from app.services.errors import ConflictError


async def resolve(
    session: AsyncSession, db: Any, conversation_id: str, membership_id: int, *, actor: User
) -> ConversationRead:
    """Retire la tâche si la candidature est déjà confirmée sur le parcours choisi."""
    doc = await conversations.get_doc(db, conversation_id)
    handoff = doc.get("handoff") or {}
    if (
        doc["status"] != ConversationStatus.HANDED_OFF.value
        or handoff.get("reason") != "candidature_a_verifier"
    ):
        raise ConflictError("Aucune candidature en attente de vérification sur cette conversation")

    membership = await session.get(CampaignProspect, membership_id)
    if membership is None or membership.prospect_id != doc["prospect_id"]:
        raise ConflictError("Ce parcours ne correspond pas au prospect de la candidature")
    if membership.conversion_stage not in {ConversionStage.APPLIED, ConversionStage.CONVERTED}:
        raise ConflictError("Confirmez d'abord la candidature déposée sur ce parcours")

    updated = await db[conversations.COLLECTION].find_one_and_update(
        {
            "_id": doc["_id"],
            "status": ConversationStatus.HANDED_OFF.value,
            "handoff.reason": "candidature_a_verifier",
            "handoff.created_at": handoff.get("created_at"),
        },
        {
            "$set": {"status": ConversationStatus.OPEN.value},
            "$push": {
                "application_reviews": {
                    "membership_id": membership_id,
                    "actor_user_id": actor.id,
                    "reviewed_at": datetime.now(UTC),
                },
            },
            "$unset": {"handoff": ""},
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise ConflictError("La demande a changé ; actualisez la file avant de continuer")
    return conversations.to_read(updated)
