"""Déclenchement automatique de l'agent et exécution des relances programmées (F-06, F-16).

- `reply_to_message` : tâche de fond lancée dès qu'un message du prospect est enregistré ; l'agent
  prépare sa réponse (brouillon en mode assisté, rien en mode manuel). Un verrou par conversation
  évite deux réponses simultanées : le second passage voit que l'agent a déjà répondu et s'arrête.
- `run_due_follow_ups` : relance les prospects restés silencieux. Garde-fous : jours ouvrés de 8 h
  à 19 h (heure de Paris), arrêt en mode manuel, jamais vers un prospect désinscrit ou qui a
  répondu, au plus `follow_up_max_per_silence` relances sans réponse. Une relance est « réclamée »
  de façon atomique : deux processus ne peuvent pas envoyer la même.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runtime import run_agent
from app.config import Settings
from app.graph.ports import Calendar, KnowledgeBase, LanguageModel
from app.integrations.email.base import EmailClient
from app.integrations.email.factory import create_email_client
from app.models import FollowUp, Prospect
from app.models.enums import FollowUpStatus
from app.services import (
    agent_settings,
    commercial_context,
    conversations,
    drafts,
    email_sync,
    lease,
)
from app.services.agent_events import enqueue_reply
from app.services.agent_settings import AgentMode
from app.services.errors import ConflictError, NotFoundError
from app.services.prospects import get_prospect

logger = logging.getLogger(__name__)
PARIS = ZoneInfo("Europe/Paris")
BATCH = 50

SessionFactory = Callable[[], AsyncSession]


async def reply_to_message(
    conversation_id: str,
    *,
    session_factory: SessionFactory,
    db: Any,
    llm: LanguageModel,
    calendar: Calendar,
    knowledge: KnowledgeBase,
    event_id: str | None = None,
) -> None:
    """Prépare la réponse de l'agent au dernier message du prospect (tâche de fond)."""
    current_id = await enqueue_reply(db, conversation_id)
    if event_id is not None and event_id != current_id:
        await db["agent_events"].update_one(
            {"_id": event_id},
            {
                "$set": {
                    "completed": True,
                    "superseded": True,
                }
            },
        )
        return
    event_id = current_id
    if await db["agent_events"].find_one({"_id": event_id, "completed": True}):
        return
    # Une panne ou un contexte manquant garde la demande rejouable, sans boucle serrée.
    await db["agent_events"].update_one(
        {"_id": event_id},
        {
            "$set": {
                "next_attempt_at": datetime.now(UTC) + timedelta(seconds=60),
            }
        },
    )
    try:
        async with session_factory() as session:
            doc = await conversations.get_doc(db, conversation_id)
            prospect = await get_prospect(session, doc["prospect_id"])
            if doc["status"] != "open" or prospect.consent_status.value == "opted_out":
                await db["agent_events"].update_one(
                    {"_id": event_id},
                    {
                        "$set": {
                            "completed": True,
                            "cancelled": True,
                        }
                    },
                )
                return
            selected = (await commercial_context.memberships(session, [doc["prospect_id"]])).get(
                doc["prospect_id"]
            )
            if selected is None or not await commercial_context.is_active(session, selected):
                return  # file À attribuer : pas de scoring ni de message sans campagne
            await run_agent(
                session,
                db,
                llm=llm,
                calendar=calendar,
                knowledge=knowledge,
                conversation_id=conversation_id,
                event_id=event_id,
            )
            await db["agent_events"].update_one(
                {"_id": event_id},
                {"$set": {"completed": True, "at": datetime.now(UTC)}},
                upsert=True,
            )
    except (ConflictError, NotFoundError) as exc:
        logger.info("Réponse automatique ignorée (%s) : %s", conversation_id, exc)
    except Exception:
        logger.exception("Réponse automatique en erreur (conversation %s)", conversation_id)


def in_send_window(now: datetime, settings: Settings) -> bool:
    """Jours ouvrés (sauf réglage contraire), de l'heure de début (incluse) à l'heure de fin
    (exclue), heure de Paris."""
    local = now.astimezone(PARIS)
    return (local.weekday() < 5 or not settings.follow_up_weekdays_only) and (
        settings.follow_up_window_start_hour <= local.hour < settings.follow_up_window_end_hour
    )


@dataclass
class FollowUpSummary:
    executed: int = 0
    cancelled: int = 0
    skipped: str | None = None  # raison globale (mode manuel, hors fenêtre)
    notes: list[str] = field(default_factory=list)


async def _claim(session: AsyncSession, follow_up_id: int, now: datetime) -> bool:
    """Passe la relance à « exécutée » si elle est encore programmée (atomique)."""
    result = await session.execute(
        update(FollowUp)
        .where(FollowUp.id == follow_up_id, FollowUp.status == FollowUpStatus.SCHEDULED)
        .values(status=FollowUpStatus.EXECUTED, executed_at=now)
    )
    await session.commit()
    return bool(getattr(result, "rowcount", 0) == 1)


async def _cancel(session: AsyncSession, follow_up_id: int, note: str) -> None:
    follow_up = await session.get(FollowUp, follow_up_id)
    if follow_up is not None:
        follow_up.status = FollowUpStatus.CANCELLED
        follow_up.reason = f"{follow_up.reason or 'Relance'} — annulée : {note}"[:1000]
        await session.commit()


async def _release(session: AsyncSession, follow_up_id: int) -> None:
    """Panne technique : la relance n'a pas été envoyée, elle repasse à « programmée »."""
    await session.execute(
        update(FollowUp)
        .where(FollowUp.id == follow_up_id, FollowUp.status == FollowUpStatus.EXECUTED)
        .values(status=FollowUpStatus.SCHEDULED, executed_at=None)
    )
    await session.commit()


async def _relances_since_last_reply(
    session: AsyncSession, prospect_id: int, last_prospect_at: datetime | None, before_id: int
) -> int:
    stmt = (
        select(func.count())
        .select_from(FollowUp)
        .where(
            FollowUp.prospect_id == prospect_id,
            FollowUp.status == FollowUpStatus.EXECUTED,
            FollowUp.id != before_id,
        )
    )
    if last_prospect_at is not None:
        stmt = stmt.where(FollowUp.executed_at > last_prospect_at)
    return int(await session.scalar(stmt) or 0)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


async def run_due_follow_ups(
    session_factory: SessionFactory,
    db: Any,
    *,
    llm: LanguageModel,
    calendar: Calendar,
    knowledge: KnowledgeBase,
    settings: Settings,
    now: datetime | None = None,
) -> FollowUpSummary:
    now = now or datetime.now(UTC)
    summary = FollowUpSummary()
    if await agent_settings.get_mode(db) is AgentMode.MANUAL:
        summary.skipped = "mode manuel (arrêt d'urgence)"
        return summary
    if not in_send_window(now, settings):
        summary.skipped = "hors de la fenêtre d'envoi"
        return summary

    async with session_factory() as session:
        due = list(
            await session.scalars(
                select(FollowUp.id)
                .join(Prospect, Prospect.id == FollowUp.prospect_id)
                .where(or_(Prospect.email.is_(None), ~Prospect.email.ilike("%@demo.example.com")))
                .where(FollowUp.status == FollowUpStatus.SCHEDULED, FollowUp.scheduled_at <= now)
                .order_by(FollowUp.scheduled_at)
                .limit(BATCH)
            )
        )
    for follow_up_id in due:
        async with session_factory() as session:
            if not await _claim(session, follow_up_id, now):
                continue  # déjà prise par un autre processus, ou annulée entre-temps
            follow_up = await session.get(FollowUp, follow_up_id)
            assert follow_up is not None  # noqa: S101 - vient d'être réclamée
            prospect = await get_prospect(session, follow_up.prospect_id)
            if prospect.consent_status.value == "opted_out":
                await _cancel(session, follow_up_id, "prospect désinscrit")
                summary.cancelled += 1
                continue
            doc = await db["conversations"].find_one(
                {"prospect_id": prospect.id, "status": "open"}, sort=[("last_message_at", -1)]
            )
            if doc is None:
                await _cancel(session, follow_up_id, "aucune conversation ouverte")
                summary.cancelled += 1
                continue
            if doc.get("simulation"):
                await _release(session, follow_up_id)
                continue  # horloge du parcours guidé : pas de relance par le worker réel
            conv_id = str(doc["_id"])
            stamps = [
                stamp
                for m in doc.get("messages", [])
                if m["role"] == "prospect" and (stamp := _aware(m.get("created_at"))) is not None
            ]
            last_prospect = max(stamps) if stamps else None
            sent = await _relances_since_last_reply(
                session, prospect.id, last_prospect, follow_up_id
            )
            if sent >= settings.follow_up_max_per_silence:
                await _cancel(session, follow_up_id, f"{sent} relances sans réponse : on s'arrête")
                summary.cancelled += 1
                continue
            try:
                await run_agent(
                    session,
                    db,
                    llm=llm,
                    calendar=calendar,
                    knowledge=knowledge,
                    conversation_id=conv_id,
                    follow_up=True,
                    follow_up_membership_id=follow_up.campaign_prospect_id,
                )
            except ConflictError as exc:
                await _cancel(session, follow_up_id, exc.message)
                summary.cancelled += 1
                summary.notes.append(f"relance {follow_up_id} : {exc.message}")
                continue
            except Exception:
                logger.exception("Relance %s en erreur", follow_up_id)
                await session.rollback()
                await _release(session, follow_up_id)
                summary.notes.append(f"relance {follow_up_id} : erreur technique (sera retentée)")
                continue
            summary.executed += 1
    if summary.executed or summary.cancelled:
        logger.info("Relances : %d exécutée(s), %d annulée(s)", summary.executed, summary.cancelled)
    return summary


async def follow_up_loop(settings: Settings) -> None:
    """Boucle de l'exécuteur de relances (démarrée avec l'application)."""
    # Imports tardifs : ces fabriques dépendent de la couche API.
    from app.api.dependencies import get_calendar, get_knowledge_base, get_language_model
    from app.database.clients import get_mongo_db
    from app.database.session import get_sessionmaker

    while True:
        try:
            if not await lease.acquire(
                get_mongo_db(), "follow-up-worker", settings.follow_up_interval_seconds * 3
            ):
                await asyncio.sleep(settings.follow_up_interval_seconds)
                continue  # une autre instance exécute les relances
            await run_due_follow_ups(
                lambda: get_sessionmaker()(),
                get_mongo_db(),
                llm=get_language_model(settings),
                calendar=get_calendar(),
                knowledge=get_knowledge_base(settings),
                settings=settings,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Exécuteur de relances en erreur")
        await asyncio.sleep(settings.follow_up_interval_seconds)


async def email_cycle(
    settings: Settings, client: EmailClient, *, db: Any, session_factory: SessionFactory
) -> email_sync.SyncReport:
    """Un passage sur la boîte email : réception (l'agent répond aux nouveaux messages), envoi."""
    from app.api.dependencies import get_calendar, get_knowledge_base, get_language_model

    async def on_message(conversation_id: str) -> None:
        if not settings.agent_auto_reply:
            return
        await reply_to_message(
            conversation_id,
            session_factory=session_factory,
            db=db,
            llm=get_language_model(settings),
            calendar=get_calendar(),
            knowledge=get_knowledge_base(settings),
        )

    return await email_sync.run_email_cycle(session_factory, db, client, settings, on_message)


async def email_loop(settings: Settings) -> None:
    """Boucle du connecteur email. La configuration (console, à défaut `.env`) est relue à chaque
    passage : activer, désactiver ou changer de boîte ne demande pas de redémarrage."""
    from app.database.clients import get_mongo_db
    from app.database.session import get_sessionmaker
    from app.services import email_config

    while True:
        poll = settings.email_poll_seconds
        try:
            db = get_mongo_db()
            effective = await email_config.effective_settings(db, settings)
            poll = effective.email_poll_seconds
            client = create_email_client(effective)
            if client is not None and await lease.acquire(db, "email-worker", poll * 3):
                await email_cycle(
                    effective, client, db=db, session_factory=lambda: get_sessionmaker()()
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Connecteur email en erreur")
        await asyncio.sleep(poll)


__all__ = [
    "drafts",
    "email_cycle",
    "email_loop",
    "follow_up_loop",
    "in_send_window",
    "reply_to_message",
    "run_due_follow_ups",
]


async def reply_queue_loop(settings: Settings) -> None:
    """Reprend les entrées enregistrées avant un redémarrage ou une panne temporaire."""
    from app.api.dependencies import get_calendar, get_knowledge_base, get_language_model
    from app.database.clients import get_mongo_db
    from app.database.session import get_sessionmaker

    db = get_mongo_db()
    while True:
        try:
            await run_pending_replies(
                db=db,
                session_factory=get_sessionmaker(),
                llm=get_language_model(settings),
                calendar=get_calendar(),
                knowledge=get_knowledge_base(settings),
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("File de traitement des entrées indisponible")
        await asyncio.sleep(10)


async def run_pending_replies(
    *,
    db: Any,
    session_factory: SessionFactory,
    llm: LanguageModel,
    calendar: Calendar,
    knowledge: KnowledgeBase,
) -> None:
    cursor = (
        db["agent_events"]
        .find(
            {
                "completed": False,
                "next_attempt_at": {"$lte": datetime.now(UTC)},
            }
        )
        .sort("next_attempt_at", 1)
        .limit(50)
    )
    async for event in cursor:
        try:
            await reply_to_message(
                event["conversation_id"],
                session_factory=session_factory,
                db=db,
                llm=llm,
                calendar=calendar,
                knowledge=knowledge,
                event_id=event["_id"],
            )
        except NotFoundError:
            await db["agent_events"].update_one(
                {"_id": event["_id"]}, {"$set": {"completed": True, "cancelled": True}}
            )
        except Exception:
            await db["agent_events"].update_one(
                {"_id": event["_id"]},
                {"$set": {"next_attempt_at": datetime.now(UTC) + timedelta(seconds=60)}},
            )
            logger.exception("Traitement d'une entrée en erreur")
