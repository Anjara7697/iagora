"""Journal en direct de l'agent : ce qu'il fait à l'instant pour une conversation.

Deux sources, lues ensemble :
- `agent_activity` (un document par conversation) : l'exécution en cours ou la dernière, étape par
  étape, écrite par `ActivityRecorder` pendant que le graphe tourne ;
- `agent_events` (la file) : un message reçu qui attend son traitement (regroupement des emails,
  nouvel essai après une panne, mode manuel, prospect à attribuer) ou qui a été abandonné.

Confidentialité : le journal ne contient que des libellés fixes, choisis ici, et des nombres
(extraits, créneaux). Jamais le texte du modèle, le prompt, le contenu d'un message, la
justification rédigée ni le détail d'une erreur : la trace complète reste dans « Décisions de
l'agent », pour les mêmes personnes. Les documents expirent après `RETENTION`.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.agent_mode import AgentMode
from app.database.collections import AGENT_ACTIVITY, AGENT_EVENTS
from app.schemas.agent_activity import LiveActivity, LiveActivityStep

logger = logging.getLogger(__name__)

RETENTION = timedelta(hours=24)
STALE_AFTER = timedelta(minutes=3)  # une étape plus longue : exécution interrompue (redémarrage)
DONE_VISIBLE_FOR = timedelta(minutes=10)
FAILED_VISIBLE_FOR = timedelta(hours=24)

STEP_LABELS: dict[str, str] = {
    "load_prospect": "Lecture de la fiche du prospect",
    "identify_context": "Lecture de la conversation et de la campagne",
    "enrich_prospect": "Mise à jour du profil",
    "qualify_prospect": "Analyse du message",
    "calculate_score": "Calcul du score",
    "decide_next_action": "Choix de la suite",
    "generate_response": "Recherche dans la base et rédaction de la réponse",
    "get_calendar_slots": "Consultation de l'agenda",
    "propose_meeting": "Proposition de créneaux",
    "book_meeting": "Réservation du rendez-vous",
    "send_message": "Envoi du message",
    "schedule_followup": "Programmation d'une relance",
    "human_handoff": "Transfert à un conseiller",
    "handle_opt_out": "Enregistrement de la désinscription",
    "close_conversation": "Clôture de la conversation",
    "finalize": "Mise à jour de l'étape commerciale",
}
DRAFT_LABEL = "Enregistrement du brouillon à valider"
ACTION_LABELS: dict[str, str] = {
    "continue_conversation": "poursuivre l'échange",
    "nurture": "entretenir le contact",
    "propose_meeting": "proposer un rendez-vous",
    "book_meeting": "réserver le rendez-vous",
    "human_handoff": "transférer à un conseiller",
    "opt_out": "enregistrer la désinscription",
    "close": "clôturer",
}


async def ensure_indexes(db: Any) -> None:
    await db[AGENT_ACTIVITY].create_index("expires_at", expireAfterSeconds=0)
    await db[AGENT_ACTIVITY].create_index([("prospect_id", 1), ("updated_at", -1)])


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _detail(node: str, update: dict[str, Any]) -> str | None:
    """Précision sûre d'une étape terminée : un libellé fixe ou un nombre, rien d'autre."""
    if update.get("needs_human") and node not in ("human_handoff", "finalize"):
        return "un conseiller doit reprendre"
    if node == "decide_next_action":
        decision = update.get("decision")
        action = getattr(getattr(decision, "action", None), "value", None)
        return ACTION_LABELS.get(str(action)) if action else None
    if node == "generate_response" and update.get("reply_text"):
        sources = (update.get("reply_metadata") or {}).get("sources") or []
        n = len(sources)
        return f"{n} extrait{'s' if n > 1 else ''} de la base utilisé{'s' if n > 1 else ''}"
    if node == "get_calendar_slots" and "slots" in update:
        n = len(update.get("slots") or [])
        return f"{n} créneau{'x' if n > 1 else ''} disponible{'s' if n > 1 else ''}"
    if node == "send_message" and update.get("outcome") == "blocked":
        return "envoi refusé"
    return None


class ActivityRecorder:
    """Écrit le journal d'une exécution. Une panne d'écriture est journalisée et ignorée : le suivi
    ne doit jamais empêcher l'agent de répondre."""

    def __init__(
        self, db: Any, conversation_id: str, prospect_id: int, *, mode: AgentMode, trigger: str
    ) -> None:
        self._db = db
        self._id = conversation_id
        self._prospect_id = prospect_id
        self._draft = mode is AgentMode.ASSISTED
        self._trigger = trigger
        self._steps: list[dict[str, Any]] = []

    async def _write(self, fields: dict[str, Any]) -> None:
        now = _now()
        try:
            await self._db[AGENT_ACTIVITY].update_one(
                {"_id": self._id},
                {
                    "$set": {
                        **fields,
                        "conversation_id": self._id,
                        "prospect_id": self._prospect_id,
                        "updated_at": now,
                        "expires_at": now + RETENTION,
                    }
                },
                upsert=True,
            )
        except Exception:
            logger.warning("Journal en direct indisponible (conversation %s)", self._id)

    async def begin(self) -> None:
        self._steps = []
        await self._write(
            {
                "run_state": "running",
                "trigger": self._trigger,
                "steps": [],
                "started_at": _now(),
                "finished_at": None,
                "outcome": None,
            }
        )

    async def step_started(self, node: str) -> None:
        label = STEP_LABELS.get(node, "Étape de l'agent")
        if node == "send_message" and self._draft:
            label = DRAFT_LABEL
        self._steps.append(
            {"node": node, "label": label, "status": "running", "started_at": _now()}
        )
        await self._write({"steps": self._steps})

    async def step_finished(self, node: str, update: dict[str, Any]) -> None:
        for step in reversed(self._steps):
            if step["node"] == node and step["status"] == "running":
                step |= {"status": "done", "finished_at": _now(), "detail": _detail(node, update)}
                break
        await self._write({"steps": self._steps})

    async def end(self, outcome: str) -> None:
        await self._write(
            {"run_state": "done", "outcome": outcome, "finished_at": _now(), "steps": self._steps}
        )

    async def fail(self) -> None:
        # Le type d'erreur reste dans les journaux du serveur et dans `agent_runs`.
        await self._write({"run_state": "error", "finished_at": _now(), "steps": self._steps})


def describe(
    activity: dict[str, Any] | None,
    pending: dict[str, Any] | None,
    failed: dict[str, Any] | None,
    *,
    now: datetime,
    manual_mode: bool = False,
    unassigned: bool = False,
    campaign_paused: bool = False,
) -> LiveActivity | None:
    """Combine le journal et la file en un état affichable (None : rien à montrer)."""
    if activity is None and pending is None and failed is None:
        return None
    base = activity or pending or failed or {}
    result = LiveActivity(
        conversation_id=str(base.get("conversation_id")),
        prospect_id=int(base.get("prospect_id", 0)),
        state="done",
    )
    run_state = activity.get("run_state") if activity else None
    updated = _aware(activity.get("updated_at")) if activity else None
    finished = _aware(activity.get("finished_at")) if activity else None
    if activity is not None:
        result.started_at = _aware(activity.get("started_at"))
        result.updated_at = updated
        result.finished_at = finished
        result.outcome = activity.get("outcome")
        result.steps = [LiveActivityStep(**s) for s in activity.get("steps", [])]

    if run_state == "running" and updated is not None and now - updated < STALE_AFTER:
        result.state = "running"
        return result
    if pending is not None:
        result.next_attempt_at = _aware(pending.get("next_attempt_at"))
        retrying = int(pending.get("errors", 0)) > 0 or run_state in ("error", "running")
        if manual_mode:
            result.state, result.waiting_reason = "waiting", "manual_mode"
        elif unassigned:
            result.state, result.waiting_reason = "waiting", "unassigned"
        elif campaign_paused:
            result.state, result.waiting_reason = "waiting", "campaign_paused"
        elif retrying:
            result.state = "retrying"
        elif result.next_attempt_at is not None and result.next_attempt_at > now:
            result.state, result.waiting_reason = "waiting", "grouping"
        else:
            result.state = "queued"
        if result.state != "retrying":
            result.steps = []  # étapes d'un passage précédent : sans rapport avec l'attente
        return result
    if run_state == "running":
        result.state = "stalled"
        return result
    failed_at = _aware(failed.get("completed_at")) if failed else None
    recent_failure = failed_at is not None and now - failed_at < FAILED_VISIBLE_FOR
    if recent_failure and (finished is None or (failed_at and failed_at >= finished)):
        result.state = "failed"
        return result
    if run_state == "error" and finished is not None and now - finished < FAILED_VISIBLE_FOR:
        result.state = "failed"
        return result
    if run_state == "done" and finished is not None and now - finished < DONE_VISIBLE_FOR:
        result.state = "done"
        return result
    return None


async def _waiting_flags(
    session: Any, db: Any, prospect_ids: list[int]
) -> tuple[bool, set[int], set[int]]:
    """Mode manuel, prospects sans rattachement actif (file « À attribuer ») et prospects dont la
    campagne a arrêté l'agent pour les réponses (D-51)."""
    from app.services import agent_settings, commercial_context

    manual = await agent_settings.get_mode(db) is AgentMode.MANUAL
    unassigned: set[int] = set()
    paused: set[int] = set()
    if prospect_ids:
        stopped = await agent_settings.campaigns_paused_for(db, agent_settings.MessageKind.REPLY)
        memberships = await commercial_context.memberships(session, prospect_ids)
        campaigns = await commercial_context.campaign_ids(session, prospect_ids) if stopped else {}
        for pid in set(prospect_ids):
            membership = memberships.get(pid)
            if membership is None or not await commercial_context.is_active(session, membership):
                unassigned.add(pid)
            elif campaigns.get(pid) in stopped:
                paused.add(pid)
    return manual, unassigned, paused


async def for_conversation(session: Any, db: Any, conversation_id: str) -> LiveActivity | None:
    activity = await db[AGENT_ACTIVITY].find_one({"_id": conversation_id})
    pending = await db[AGENT_EVENTS].find_one(
        {"conversation_id": conversation_id, "completed": False}, sort=[("next_attempt_at", 1)]
    )
    failed = await db[AGENT_EVENTS].find_one(
        {"conversation_id": conversation_id, "failed": True}, sort=[("completed_at", -1)]
    )
    manual, unassigned, paused = False, set[int](), set[int]()
    if pending is not None:
        manual, unassigned, paused = await _waiting_flags(
            session, db, [int(pending["prospect_id"])]
        )
    return describe(
        activity,
        pending,
        failed,
        now=_now(),
        manual_mode=manual,
        unassigned=int(pending["prospect_id"]) in unassigned if pending else False,
        campaign_paused=int(pending["prospect_id"]) in paused if pending else False,
    )


ACTIVE_STATES = ("queued", "waiting", "running", "retrying", "stalled")


async def active(
    session: Any, db: Any, match: dict[str, Any], *, limit: int = 50
) -> list[LiveActivity]:
    """Conversations où l'agent travaille ou attend, les plus récentes d'abord.

    `match` : filtre `prospect_id` du périmètre de l'utilisateur (`scope.mongo_match`)."""
    now = _now()
    activities = {
        d["_id"]: d
        async for d in db[AGENT_ACTIVITY]
        .find({**match, "run_state": "running", "updated_at": {"$gte": now - FAILED_VISIBLE_FOR}})
        .sort("updated_at", -1)
        .limit(limit)
    }
    pendings: dict[str, dict[str, Any]] = {}
    async for event in (
        db[AGENT_EVENTS].find({**match, "completed": False}).sort("next_attempt_at", 1).limit(limit)
    ):
        pendings.setdefault(event["conversation_id"], event)
    for conv_id in set(pendings) - set(activities):
        doc = await db[AGENT_ACTIVITY].find_one({"_id": conv_id})
        if doc is not None:
            activities[conv_id] = doc
    manual, unassigned, paused = await _waiting_flags(
        session, db, [int(e["prospect_id"]) for e in pendings.values()]
    )
    items: list[LiveActivity] = []
    for conv_id in set(activities) | set(pendings):
        pending = pendings.get(conv_id)
        item = describe(
            activities.get(conv_id),
            pending,
            None,
            now=now,
            manual_mode=manual,
            unassigned=pending is not None and int(pending["prospect_id"]) in unassigned,
            campaign_paused=pending is not None and int(pending["prospect_id"]) in paused,
        )
        if item is not None and item.state in ACTIVE_STATES:
            items.append(item)
    order = {"running": 0, "retrying": 1, "stalled": 2, "queued": 3, "waiting": 4}
    epoch = datetime.min.replace(tzinfo=UTC)
    items.sort(key=lambda a: (order[a.state], -(a.updated_at or epoch).timestamp()))
    return items[:limit]
