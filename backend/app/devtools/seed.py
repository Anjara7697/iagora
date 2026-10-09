"""Jeu de données de démonstration : personnes et entreprises fictives (adresses @demo.example.com).

Construit via les services métier (pas d'insertion directe) : les scores, étapes et historiques
sont donc cohérents et justifiés comme en usage réel. Idempotent ; `reset` supprime uniquement
les lignes marquées démo (domaine @demo.example.com et campagnes « [DÉMO] »).
"""

import dataclasses
import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.devtools.runner import DEMO_DOMAIN
from app.graph.ports import HandoffSheet
from app.models import Campaign, CampaignSource, Prospect, Source
from app.models.enums import (
    CampaignStatus,
    ConversationStatus,
    ConversionStage,
    ScoreType,
    SenderType,
)
from app.schemas.appointment import AppointmentData
from app.schemas.campaign import CampaignCreate, SourceInput
from app.schemas.conversation import ConversationCreate, ConversationUpdate, MessageCreate
from app.schemas.prospect import ProspectIngest
from app.services import (
    appointments,
    campaigns,
    conversations,
    follow_ups,
    pipeline,
    prospects,
    scoring,
)

PREFIX = "[DÉMO]"
DEMO_REASON = "Jeu de données de démonstration"
P, A = SenderType.PROSPECT, SenderType.AGENT


def _slug(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


@dataclass
class Demo:
    first: str
    last: str
    campaign: int  # indice dans CAMPAIGNS
    source: int  # indice de la source dans la campagne
    stage: ConversionStage = ConversionStage.NEW
    interest: int = 0
    fit: int = 0
    target: str = "ebihar_students"
    profile: dict[str, str] = field(default_factory=dict)
    channel: str = "email"
    messages: list[tuple[SenderType, str]] = field(default_factory=list)
    extra: str = ""  # handoff | appointment | follow_up | opted_out | closed

    @property
    def email(self) -> str:
        return f"{_slug(self.first)}.{_slug(self.last)}@{DEMO_DOMAIN}"


CAMPAIGNS = [
    (
        f"{PREFIX} Recrutement eBIHAR 2026",
        ["ebihar_students"],
        [("LinkedIn", "ads", "linkedin"), ("Landing page", "landing_page", "web")],
    ),
    (
        f"{PREFIX} Les Compagnons — montée en compétences",
        ["compagnons_pros"],
        [("Facebook", "ads", "meta"), ("Formulaire web", "form", "web")],
    ),
    (
        f"{PREFIX} Master eBIHAR — alternance",
        ["master_candidates", "master_companies"],
        [("Webinaire", "webinar", "web")],
    ),
]

S = ConversionStage
DEMOS = [
    Demo("Léa", "Moreau", 0, 0),
    Demo(
        "Hugo",
        "Petit",
        0,
        1,
        S.CONTACTED,
        10,
        messages=[
            (
                A,
                "Bonjour Hugo, je suis l'assistant virtuel de DATUM Academy. Qu'est-ce qui vous amène ?",
            )
        ],
    ),
    Demo(
        "Inès",
        "Lambert",
        0,
        0,
        S.IN_CONVERSATION,
        35,
        20,
        profile={"study_level": "Bac+3"},
        messages=[
            (P, "Bonjour, je voudrais des informations sur le programme."),
            (A, "Bonjour Inès, avec plaisir. Quel est votre niveau d'études ?"),
            (P, "Je suis en Bac+3 d'informatique."),
        ],
    ),
    Demo(
        "Nathan",
        "Roux",
        0,
        1,
        S.QUALIFIED,
        70,
        50,
        profile={"study_level": "Bac+5", "goal": "devenir data engineer"},
        messages=[
            (P, "Je cherche une formation en data engineering."),
            (A, "Très bien. Quel est votre niveau d'études ?"),
            (P, "Bac+5, je veux devenir data engineer."),
        ],
    ),
    Demo(
        "Chloé",
        "Fabre",
        0,
        0,
        S.MEETING_PROPOSED,
        75,
        40,
        profile={"study_level": "Bac+3", "goal": "data analyst"},
        messages=[
            (P, "Je voudrais parler à un conseiller."),
            (A, "Voici des créneaux disponibles : 1. lundi 1 mars à 14h00 2. mardi 2 mars à 14h00"),
        ],
    ),
    Demo(
        "Maxime",
        "Girard",
        0,
        1,
        S.MEETING_SCHEDULED,
        90,
        60,
        profile={"study_level": "Bac+4", "goal": "data scientist"},
        messages=[
            (P, "Le deuxième créneau me convient."),
            (A, "C'est noté : rendez-vous mardi 2 mars à 14h00."),
        ],
        extra="appointment",
    ),
    Demo(
        "Sarah",
        "Bonnet",
        0,
        0,
        S.TO_FOLLOW_UP,
        5,
        messages=[
            (P, "Je regardais un peu votre site."),
            (A, "Merci pour votre message. N'hésitez pas à me poser vos questions."),
        ],
        extra="follow_up",
    ),
    Demo(
        "Lucas",
        "Mercier",
        0,
        1,
        S.LOST,
        0,
        messages=[(P, "Non merci, ça ne m'intéresse pas.")],
        extra="closed",
    ),
    Demo(
        "Emma",
        "Faure",
        1,
        0,
        S.IN_CONVERSATION,
        30,
        25,
        target="compagnons_pros",
        profile={"current_situation": "analyste en reconversion"},
        messages=[
            (P, "Je voudrais monter en compétences en data."),
            (A, "Bonjour Emma, quelle est votre situation actuelle ?"),
            (P, "Analyste, je veux me reconvertir."),
        ],
    ),
    Demo(
        "Antoine",
        "Blanc",
        1,
        1,
        S.IN_CONVERSATION,
        20,
        20,
        target="compagnons_pros",
        messages=[
            (P, "Quel est le coût exact et puis-je utiliser mon CPF ?"),
            (
                A,
                "Je transmets votre demande à un conseiller de DATUM Academy, qui reprendra la conversation avec vous.",
            ),
        ],
        extra="handoff",
    ),
    Demo(
        "Julie",
        "Garnier",
        1,
        0,
        S.LOST,
        15,
        target="compagnons_pros",
        messages=[(P, "STOP, ne m'écrivez plus.")],
        extra="opted_out",
    ),
    Demo(
        "Thomas",
        "Chevalier",
        2,
        0,
        S.QUALIFIED,
        65,
        45,
        target="master_candidates",
        profile={"study_level": "Bac+3", "availability": "septembre"},
        messages=[
            (P, "Je cherche une alternance en data pour septembre."),
            (A, "Très bien Thomas, quel est votre niveau d'études ?"),
            (P, "Bac+3, disponible en septembre."),
        ],
    ),
    Demo(
        "Manon",
        "Perrin",
        2,
        0,
        S.CONTACTED,
        8,
        target="master_candidates",
        messages=[
            (A, "Bonjour Manon, merci de votre inscription au webinaire. Que recherchez-vous ?")
        ],
    ),
    Demo(
        "Karim",
        "Benali",
        2,
        0,
        S.IN_CONVERSATION,
        40,
        35,
        target="master_companies",
        profile={"company_need": "deux alternants data analyst"},
        messages=[
            (P, "Nous cherchons deux alternants data analyst."),
            (A, "Merci. Pour quelle date souhaitez-vous les accueillir ?"),
        ],
    ),
]


@dataclass
class SeedSummary:
    created: int = 0
    already_present: bool = False
    removed: int = 0


async def _campaign_ids(session: AsyncSession) -> list[tuple[int, list[int]]]:
    result = []
    for name, _, _ in CAMPAIGNS:
        campaign = await session.scalar(select(Campaign).where(Campaign.name == name))
        if campaign is None:
            return []
        read = await campaigns.to_read(session, campaign)
        result.append((read.id, [s.id for s in read.sources]))
    return result


async def seed_demo(session: AsyncSession, db: Any, *, reset: bool = False) -> SeedSummary:
    summary = SeedSummary()
    if reset:
        summary.removed = await reset_demo(session, db)
    elif await _campaign_ids(session):
        summary.already_present = True
        return summary

    for name, targets, sources in CAMPAIGNS:
        await campaigns.create_campaign(
            session,
            CampaignCreate(
                name=name,
                status=CampaignStatus.ACTIVE,
                target_codes=targets,
                sources=[SourceInput(name=n, type=t, platform=p) for n, t, p in sources],
            ),
        )
    ids = await _campaign_ids(session)

    for demo in DEMOS:
        campaign_id, source_ids = ids[demo.campaign]
        prospect, _, _ = await prospects.ingest_prospect(
            session,
            ProspectIngest(
                first_name=demo.first,
                last_name=demo.last,
                email=demo.email,
                channel=demo.channel,
                target_code=demo.target,
                campaign_id=campaign_id,
                source_id=source_ids[demo.source],
                profile=dict(demo.profile),
                consent_granted=demo.extra != "opted_out",
                consent_source="demo",
            ),
        )
        mid = (await prospects.get_memberships(session, prospect.id))[0].id
        cid = None
        if demo.messages:
            conv, _ = await conversations.create_conversation(
                session, db, ConversationCreate(prospect_id=prospect.id, channel=demo.channel)
            )
            cid = conv.id
            for role, text in demo.messages:
                await conversations.add_message(
                    session, db, cid, MessageCreate(role=role, content=text)
                )
        for score_type, points in ((ScoreType.INTEREST, demo.interest), (ScoreType.FIT, demo.fit)):
            if points:
                await scoring.apply_score(session, mid, score_type, points, DEMO_REASON)
        if demo.stage is not ConversionStage.NEW:
            await pipeline.change_stage(session, mid, demo.stage, DEMO_REASON)
        await _extras(session, db, demo, prospect.id, mid, cid)
        summary.created += 1
    return summary


async def _extras(
    session: AsyncSession, db: Any, demo: Demo, pid: int, mid: int, cid: str | None
) -> None:
    if demo.extra == "appointment":
        start = datetime(2027, 3, 2, 13, 0, tzinfo=UTC)
        await appointments.create_appointment(
            session,
            pid,
            None,
            AppointmentData(
                calendar_event_id=f"demo-event-{pid}",
                zoom_meeting_id=f"demo-zoom-{pid}",
                meeting_url="https://zoom.example/demo",
                start_at=start,
                end_at=start + timedelta(hours=1),
            ),
        )
    elif demo.extra == "follow_up":
        await follow_ups.schedule_follow_up(
            session, pid, mid, "email", timedelta(days=7), DEMO_REASON
        )
    elif demo.extra == "handoff" and cid:
        sheet = HandoffSheet(
            reason="question_hors_base",
            identity={
                "first_name": demo.first,
                "last_name": demo.last,
                "email": demo.email,
                "phone": None,
            },
            campaign=CAMPAIGNS[demo.campaign][0],
            source=CAMPAIGNS[demo.campaign][2][demo.source][0],
            channel=demo.channel,
            summary=f"{demo.first} demande le coût exact et la possibilité de financement par le CPF.",
            history=[{"role": r.value, "content": t, "at": None} for r, t in demo.messages],
            score={"interest": demo.interest, "fit": demo.fit, "total": 0, "level": "cold"},
            qualification={"intent": "question", "profile": demo.profile, "missing": ["goal"]},
            pending_question=demo.messages[0][1],
            recommended_action="Répondre à la question du prospect, absente de la base de connaissances",
        )
        await conversations.set_handoff(db, cid, dataclasses.asdict(sheet))
    elif demo.extra == "opted_out":
        await prospects.opt_out(session, pid, "demo", demo.channel)
        if cid:
            await conversations.update_conversation(
                db, cid, ConversationUpdate(status=ConversationStatus.CLOSED)
            )
    elif demo.extra == "closed" and cid:
        await conversations.update_conversation(
            db, cid, ConversationUpdate(status=ConversationStatus.CLOSED)
        )


async def reset_demo(session: AsyncSession, db: Any) -> int:
    """Supprime les données de démonstration et de recette. Retourne le nombre de prospects."""
    ids = list(
        await session.scalars(select(Prospect.id).where(Prospect.email.like(f"%@{DEMO_DOMAIN}")))
    )
    if ids:
        await db["conversations"].delete_many({"prospect_id": {"$in": ids}})
        await db["agent_runs"].delete_many({"prospect_id": {"$in": ids}})
        await session.execute(delete(Prospect).where(Prospect.id.in_(ids)))
    demo_campaigns = list(
        await session.scalars(select(Campaign.id).where(Campaign.name.like(f"{PREFIX}%")))
    )
    if demo_campaigns:
        source_ids = list(
            await session.scalars(
                select(CampaignSource.source_id).where(
                    CampaignSource.campaign_id.in_(demo_campaigns)
                )
            )
        )
        await session.execute(delete(Campaign).where(Campaign.id.in_(demo_campaigns)))
        if source_ids:
            await session.execute(delete(Source).where(Source.id.in_(source_ids)))
    await session.commit()
    return len(ids)
