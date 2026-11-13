"""Remise à zéro des données d'une instance d'essai (décision D-30), jamais en production.

Efface tout le contenu métier pour repartir d'une console vide : prospects et tout ce qui en dépend
(rattachements, échanges, scores, étapes, relances, rendez-vous, consentements, liste d'opposition),
campagnes et sources, base de connaissances, conversations, décisions et file de l'agent, événements
Meta reçus.

Conserve ce qui sert à travailler : comptes et sessions, réglages de la console (Paramètres, boîte
email, agenda, Zoom, Meta, clés chiffrées), connexions des conseillers à leur agenda et jetons de
service. Les destinations devenues orphelines (formulaire Meta ou jeton rattaché à une campagne
effacée) sont vidées : les prospects reçus ensuite arrivent dans « À attribuer ».
"""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database.collections import AGENT_EVENTS, AGENT_RUNS, CONVERSATIONS
from app.models import (
    Appointment,
    Campaign,
    CampaignProspect,
    CampaignSource,
    CampaignTarget,
    ConsentEvent,
    ErasureRecord,
    FollowUp,
    Interaction,
    KnowledgeChunk,
    KnowledgeDocument,
    Prospect,
    ProspectChannel,
    ScoreEvent,
    Source,
    StageEvent,
)
from app.services import meta_config, meta_leads, service_tokens
from app.services.errors import ConflictError

# Ordre de suppression : les tables qui en référencent d'autres d'abord.
TABLES: list[tuple[str, Any]] = [
    ("événements de score", ScoreEvent),
    ("changements d'étape", StageEvent),
    ("relances", FollowUp),
    ("rendez-vous", Appointment),
    ("interactions", Interaction),
    ("consentements", ConsentEvent),
    ("canaux des prospects", ProspectChannel),
    ("rattachements aux campagnes", CampaignProspect),
    ("prospects", Prospect),
    ("programmes des campagnes", CampaignTarget),
    ("sources des campagnes", CampaignSource),
    ("campagnes", Campaign),
    ("sources", Source),
    ("liste d'opposition (empreintes)", ErasureRecord),
    ("extraits de la base de connaissances", KnowledgeChunk),
    ("documents de la base de connaissances", KnowledgeDocument),
]
COLLECTIONS: list[tuple[str, str]] = [
    ("conversations", CONVERSATIONS),
    ("décisions de l'agent", AGENT_RUNS),
    ("file de l'agent", AGENT_EVENTS),
    ("événements Meta reçus", meta_leads.COLLECTION),
]


@dataclass
class ResetReport:
    counts: dict[str, int] = field(default_factory=dict)
    detached: list[str] = field(default_factory=list)


def guard(settings: Settings) -> None:
    if settings.environment == "production":
        raise ConflictError("Refusé : la remise à zéro des données est interdite en production")


async def preview(session: AsyncSession, db: Any) -> ResetReport:
    report = ResetReport()
    for label, model in TABLES:
        report.counts[label] = int(await session.scalar(select(func.count()).select_from(model)))
    for label, name in COLLECTIONS:
        report.counts[label] = await db[name].count_documents({})
    return report


async def reset(session: AsyncSession, db: Any, settings: Settings) -> ResetReport:
    """Efface les données ; renvoie ce qui existait juste avant."""
    guard(settings)
    report = await preview(session, db)
    for _, model in TABLES:
        await session.execute(delete(model))
    await session.commit()
    for _, name in COLLECTIONS:
        await db[name].delete_many({})
    # Destinations orphelines : formulaires Meta et jetons de service rattachés à une campagne.
    meta = await db[meta_config.COLLECTION].update_one(
        {"_id": meta_config.KEY, "mappings.0": {"$exists": True}}, {"$set": {"mappings": []}}
    )
    if meta.modified_count:
        report.detached.append("formulaires Meta : à rattacher de nouveau à une campagne")
    tokens = await db[service_tokens.COLLECTION].update_many(
        {"campaign_id": {"$ne": None}}, {"$set": {"campaign_id": None, "source_id": None}}
    )
    if tokens.modified_count:
        report.detached.append(
            f"{tokens.modified_count} jeton(s) de service : destination à choisir de nouveau"
        )
    return report
