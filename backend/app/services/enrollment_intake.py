"""Repérer une confirmation d'admission et la rattacher sans convertir automatiquement."""

import re
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.email.base import InboundEmail
from app.models import Campaign, CampaignProspect, CampaignSource, Prospect
from app.models.enums import ConversionStage
from app.services.application_intake import DocumentEvidence, normalized

EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
CONFIRMATION = re.compile(
    r"\b(?:admission\s+(?:est\s+)?confirmee|candidature\s+(?:est\s+)?acceptee|"
    r"inscription\s+(?:est\s+)?(?:confirmee|validee)|(?:vous|tu)\s+etes\s+admis(?:e)?)\b"
)
NEGATIVE = re.compile(
    r"\b(?:admission|candidature|inscription).{0,30}"
    r"(?:refusee|rejetee|non\s+retenue|pas\s+acceptee|annulee)\b"
)


@dataclass(frozen=True)
class EnrollmentReview:
    prospect_id: int
    sheet: dict[str, str]


def text_from(mail: InboundEmail, evidence: list[DocumentEvidence]) -> str:
    return "\n".join([mail.subject, mail.text, *(item.text for item in evidence)])


def looks_like_confirmation(mail: InboundEmail, evidence: list[DocumentEvidence]) -> bool:
    haystack = normalized(text_from(mail, evidence))
    return bool(CONFIRMATION.search(haystack) and not NEGATIVE.search(haystack))


async def review(
    session: AsyncSession,
    mail: InboundEmail,
    evidence: list[DocumentEvidence],
) -> EnrollmentReview | None:
    """Retourne une preuve à vérifier seulement si un unique candidat déposé correspond."""
    if mail.suspect:
        return None
    text = text_from(mail, evidence)
    if not looks_like_confirmation(mail, evidence):
        return None

    addresses = {address.casefold() for address in EMAIL.findall(text)}
    addresses.add(mail.from_address.casefold())
    rows = list(
        await session.execute(
            select(Prospect.id, Prospect.email, CampaignProspect.id, Campaign.name)
            .join(CampaignProspect, CampaignProspect.prospect_id == Prospect.id)
            .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
            .join(Campaign, Campaign.id == CampaignSource.campaign_id)
            .where(
                func.lower(Prospect.email).in_(addresses),
                CampaignProspect.conversion_stage == ConversionStage.APPLIED,
            )
        )
    )
    prospect_ids = {row[0] for row in rows}
    if len(prospect_ids) != 1:
        return None
    prospect_id = prospect_ids.pop()
    matches = [row for row in rows if row[0] == prospect_id]
    candidate_email = matches[0][1] or "adresse inconnue"
    campaigns = sorted({row[3] for row in matches})
    documents = ", ".join(f"{item.filename} ({item.note})" for item in evidence)
    source = f"email de {mail.from_address} reçu le {mail.received_at:%d/%m/%Y}"
    summary = (
        f"Confirmation possible pour {candidate_email}. "
        f"Parcours déposés : {', '.join(campaigns)}. "
        f"Source : {source}. "
        f"Documents : {documents or 'aucun document joint'}. "
        "Vérifier l'email original et choisir le bon parcours avant de confirmer l'inscription."
    )
    return EnrollmentReview(
        prospect_id=prospect_id,
        sheet={
            "reason": "inscription_a_verifier",
            "summary": summary[:1500],
            "pending_question": mail.subject[:300] or mail.text[:500],
            "recommended_action": "Vérifier la preuve et confirmer l'inscription",
            "evidence_reference": source[:300],
        },
    )
