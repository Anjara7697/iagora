"""Parcours guidé persistant : vrai graphe/LLM, connaissances et agenda fictifs explicites."""

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import runtime
from app.devtools.fakes import FakeCalendar, FakeKnowledge
from app.devtools.runner import new_demo_prospect
from app.devtools.scenarios import DEMO_FACT
from app.graph import policy
from app.graph.ports import LanguageModel, Passage, Slot
from app.models import Appointment
from app.models.enums import SenderType
from app.schemas.conversation import MessageCreate
from app.services import agent_settings, conversations, drafts, lease
from app.services.agent_settings import AgentMode
from app.services.errors import ConflictError, NotFoundError
from app.services.prospects import get_prospect

VERSION = "qualification-meeting-v1"
GUIDE = [
    "Bonjour, je cherche une formation pour devenir data analyst. Comment se déroule le programme ?",
    "J’ai un Bac+3 en informatique et je souhaite travailler en alternance.",
    "Je crains de ne pas trouver d’entreprise. Quel accompagnement proposez-vous ?",
    "Je voudrais prendre rendez-vous avec un conseiller.",
    "Le deuxième créneau me convient.",
]


async def create(session: AsyncSession, db: Any, first_name: str) -> dict[str, Any]:
    pid, _, cid = await new_demo_prospect(session, db, label="journey", first_name=first_name)
    await db[conversations.COLLECTION].update_one(
        {"_id": (await conversations.get_doc(db, cid))["_id"]},
        {"$set": {"simulation": {"scenario": VERSION, "created_at": datetime.now(UTC)}}},
    )
    return {"prospect_id": pid, "conversation_id": cid, "scenario": VERSION, "guide": GUIDE}


async def require(session: AsyncSession, db: Any, cid: str) -> dict[str, Any]:
    doc = await conversations.get_doc(db, cid)
    prospect = await get_prospect(session, doc["prospect_id"])
    if (doc.get("simulation") or {}).get("scenario") != VERSION or not (
        prospect.email or ""
    ).lower().endswith("@demo.example.com"):
        raise NotFoundError("Session de simulation introuvable")
    return doc


def calendar_for(doc: dict[str, Any]) -> FakeCalendar:
    created = doc["simulation"]["created_at"]
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    base = (created + timedelta(days=7)).replace(hour=13, minute=0, second=0, microsecond=0)
    return FakeCalendar(
        [
            Slot(
                id=f"simulation-{doc['_id']}-{i}",
                start=base + timedelta(days=i),
                end=base + timedelta(days=i, hours=1),
            )
            for i in range(3)
        ]
    )


async def dispatch(session: AsyncSession, db: Any, cid: str) -> None:
    """Livraison uniquement dans la boîte fictive ; jamais de client SMTP.

    Le statut distinct `simulated` ne peut être sélectionné par l'outbox SMTP.
    Le même verrou que le runtime empêche deux livraisons concurrentes.
    """
    async with lease.conversation_lock(db, cid):
        doc = await require(session, db, cid)
        prospect = await get_prospect(session, doc["prospect_id"])
        await session.refresh(prospect)
        if (
            await agent_settings.get_mode(db) is AgentMode.MANUAL
            or prospect.consent_status.value == "opted_out"
            or doc["status"] == "closed"
        ):
            return
        for message in doc.get("messages", []):
            meta = message.get("metadata") or {}
            if (
                message["role"] not in {"agent", "advisor"}
                or meta.get("delivery") != "not_sent"
                or drafts.is_pending(message)
                or drafts.is_dead(message)
            ):
                continue
            await db[conversations.COLLECTION].update_one(
                {
                    "_id": doc["_id"],
                    "status": {"$ne": "closed"},
                    "messages": {
                        "$elemMatch": {
                            "id": message["id"],
                            "metadata.delivery": "not_sent",
                        }
                    },
                },
                {"$set": {"messages.$.metadata.delivery": "simulated"}},
            )


async def run(
    session: AsyncSession, db: Any, cid: str, llm: LanguageModel, *, regenerate: bool = False
) -> None:
    doc = await require(session, db, cid)
    inputs = [m for m in doc.get("messages", []) if m["role"] == "prospect"]
    if inputs and policy.is_opt_out(inputs[-1]["content"]):
        return  # le traitement d'entrée a déjà consigné STOP et annulé les brouillons/relances
    await runtime.run_agent(
        session,
        db,
        conversation_id=cid,
        llm=llm,
        calendar=calendar_for(doc),
        knowledge=FakeKnowledge(
            [
                DEMO_FACT,
                Passage(
                    source="Accompagnement (FICTIF)",
                    text="Dans ce programme de démonstration en alternance, un conseiller accompagne la recherche d’entreprise et la préparation du CV, sans garantir de contrat.",
                ),
            ]
        ),
        simulation=True,
        event_id=(
            None
            if regenerate and doc.get("messages") and drafts.is_dead(doc["messages"][-1])
            else f"{cid}:{inputs[-1]['id'] if inputs else 'first'}"
        ),
    )
    await dispatch(session, db, cid)


async def receive(
    session: AsyncSession,
    db: Any,
    cid: str,
    content: str,
    external_id: str,
    llm: LanguageModel,
) -> None:
    doc = await require(session, db, cid)
    previous = next(
        (m for m in doc["messages"] if m.get("external_message_id") == external_id), None
    )
    if previous is not None and previous["content"] != content:
        raise ConflictError("Cet identifiant appartient déjà à un autre message")
    if (
        previous is None
        and any(drafts.is_pending(m) for m in doc["messages"])
        and not policy.is_opt_out(content)
    ):
        raise ConflictError("Valider ou refuser le brouillon avant la réponse du prospect simulé")
    await conversations.add_message(
        session,
        db,
        cid,
        MessageCreate(role=SenderType.PROSPECT, content=content, external_message_id=external_id),
    )
    await run(session, db, cid, llm)


async def exchange(session: AsyncSession, db: Any, cid: str) -> dict[str, Any]:
    """Vue du prospect/n8n : aucun brouillon, score, raisonnement ou métadonnée interne."""
    doc = await require(session, db, cid)
    return {
        "conversation_id": cid,
        "messages": [
            {
                "id": m["id"],
                "role": m["role"],
                "content": m["content"],
                "created_at": m["created_at"],
            }
            for m in doc["messages"]
            if m["role"] == "prospect" or (m.get("metadata") or {}).get("delivery") == "simulated"
        ],
    }


async def report(session: AsyncSession, db: Any, cid: str) -> dict[str, Any]:
    doc = await require(session, db, cid)
    appointments = list(
        (
            await session.scalars(
                select(Appointment).where(Appointment.prospect_id == doc["prospect_id"])
            )
        ).all()
    )
    return {
        "scenario": VERSION,
        "guide": GUIDE,
        "exchange": await exchange(session, db, cid),
        "appointments": [
            {
                "id": a.id,
                "start_at": a.start_at,
                "end_at": a.end_at,
                "meeting_url": a.meeting_url,
                "simulated": True,
            }
            for a in appointments
        ],
        "model_validation": "À confirmer avec le modèle configuré ; aucun verdict automatique sur la qualité commerciale.",
        "limits": [
            "Pas de transport email réel",
            "Pas de temps accéléré ni de recette des relances",
            "Documents fictifs : durée, alternance et accompagnement ; tarif et financement non documentés",
            "Un rendez-vous réservé ne constitue pas une conversion commerciale",
        ],
    }
