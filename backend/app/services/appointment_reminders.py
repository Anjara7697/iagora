"""Rappel envoyé au prospect la veille de son rendez-vous (F-19, décision D-47).

Un seul rappel, environ 24 h avant le début, sur la conversation ouverte du prospect (son canal
habituel). Le texte est écrit par le code (date, heure, fuseau, lien) : il ne contient rien de
commercial et part donc sans validation, même en mode assisté, comme l'accusé de transfert.

Pas de rappel :
- en mode manuel (arrêt d'urgence) ni hors de la fenêtre d'envoi ;
- pour un rendez-vous qui n'est plus « planifié », ou réservé moins de 24 h avant son début
  (la confirmation vient de partir) ;
- vers un prospect désinscrit, fictif (`@demo.example.com`) ou sans conversation ouverte.

Un rendez-vous dont la veille tombe hors de la fenêtre d'envoi (un lundi matin, par exemple) reçoit
son rappel à la réouverture de la fenêtre, jusqu'à 30 minutes avant le début.

Chaque rappel est « réclamé » dans MongoDB (`appointment_reminders`, identifiant unique) avant
l'écriture du message : deux processus ne peuvent pas envoyer le même.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo.errors import DuplicateKeyError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.graph import prompts
from app.graph.ports import Slot
from app.models import Appointment, Prospect
from app.models.enums import AppointmentStatus, ConsentStatus, SenderType
from app.schemas.conversation import MessageCreate
from app.services import agent_settings, conversations
from app.services.agent_settings import AgentMode
from app.services.errors import ConflictError
from app.services.send_window import in_send_window

logger = logging.getLogger(__name__)

COLLECTION = "appointment_reminders"
MODE = "appointment_reminder"
REMIND_BEFORE = timedelta(hours=24)
LATEST_BEFORE = timedelta(minutes=30)  # plus tard, le rappel n'a plus d'intérêt
BATCH = 50

SessionFactory = Callable[[], AsyncSession]


@dataclass
class ReminderSummary:
    sent: int = 0
    skipped: int = 0
    paused: str | None = None  # raison globale (mode manuel, hors fenêtre)
    notes: list[str] = field(default_factory=list)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def reminder_text(first_name: str | None, start: datetime, timezone: str, url: str | None) -> str:
    slot = Slot("rappel", start, start, timezone)
    greeting = f"Bonjour {first_name}," if first_name else "Bonjour,"
    lines = [
        greeting,
        "",
        f"Petit rappel : votre rendez-vous avec DATUM Academy est prévu "
        f"{prompts.format_slot(slot)} ({prompts.zone_label(timezone)}).",
    ]
    if url:
        lines.append(f"Lien de connexion : {url}")
    lines += ["", "En cas d'empêchement, il suffit de répondre à ce message."]
    return "\n".join(lines)


async def _record(db: Any, key: str, **fields: Any) -> None:
    await db[COLLECTION].update_one({"_id": key}, {"$set": fields})


async def run_due_reminders(
    session_factory: SessionFactory,
    db: Any,
    *,
    settings: Settings,
    now: datetime | None = None,
) -> ReminderSummary:
    now = now or datetime.now(UTC)
    summary = ReminderSummary()
    if await agent_settings.get_mode(db) is AgentMode.MANUAL:
        summary.paused = "mode manuel (arrêt d'urgence)"
        return summary
    if not in_send_window(now, settings):
        summary.paused = "hors de la fenêtre d'envoi"
        return summary

    async with session_factory() as session:
        rows = list(
            await session.execute(
                select(Appointment, Prospect)
                .join(Prospect, Prospect.id == Appointment.prospect_id)
                .where(
                    Appointment.status == AppointmentStatus.SCHEDULED,
                    Appointment.start_at > now + LATEST_BEFORE,
                    Appointment.start_at <= now + REMIND_BEFORE,
                    or_(Prospect.email.is_(None), ~Prospect.email.ilike("%@demo.example.com")),
                )
                .order_by(Appointment.start_at)
                .limit(BATCH)
            )
        )
    for appointment, prospect in rows:
        key = f"{appointment.id}:24h"
        start = _aware(appointment.start_at)
        created = _aware(appointment.created_at) if appointment.created_at else None
        if created is not None and created > start - REMIND_BEFORE:
            continue  # réservé moins de 24 h avant : la confirmation tient lieu de rappel
        if prospect.consent_status is ConsentStatus.OPTED_OUT:
            continue
        try:
            await db[COLLECTION].insert_one(
                {"_id": key, "appointment_id": appointment.id, "claimed_at": now}
            )
        except DuplicateKeyError:
            continue  # déjà envoyé (ou en cours) par un autre passage
        doc = await db["conversations"].find_one(
            {"prospect_id": prospect.id, "status": "open", "simulation": {"$ne": True}},
            sort=[("last_message_at", -1)],
        )
        if doc is None:
            await _record(db, key, skipped="aucune conversation ouverte")
            summary.skipped += 1
            continue
        text = reminder_text(
            prospect.first_name, start, settings.calendar_timezone, appointment.meeting_url
        )
        data = MessageCreate(
            role=SenderType.AGENT,
            content=text,
            # Prêt à partir : le connecteur du canal l'envoie au prochain passage, sans brouillon.
            metadata={"mode": MODE, "appointment_id": appointment.id, "delivery": "not_sent"},
        )
        try:
            async with session_factory() as session:
                await conversations.add_message(session, db, str(doc["_id"]), data)
        except ConflictError as exc:
            await _record(db, key, skipped=exc.message)
            summary.skipped += 1
            summary.notes.append(f"rappel du rendez-vous {appointment.id} : {exc.message}")
            continue
        except Exception:
            # Panne passagère : la réclamation est levée, le prochain passage réessaie.
            logger.exception("Rappel du rendez-vous %s en erreur", appointment.id)
            await db[COLLECTION].delete_one({"_id": key})
            continue
        await _record(db, key, sent_at=now, conversation_id=str(doc["_id"]))
        summary.sent += 1
    if summary.sent or summary.skipped:
        logger.info(
            "Rappels de rendez-vous : %d envoyé(s), %d écarté(s)", summary.sent, summary.skipped
        )
    return summary
