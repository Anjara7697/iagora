"""Noeuds du workflow LangGraph (CdC §9.3).

Chaque noeud lit l'état, agit via les ports (`Deps`) et retourne une mise à jour partielle de
l'état plus une entrée de journal. Aucune dépendance à une API ou à un SDK de plateforme (NF-02).
"""

import logging
from typing import Any

from app.graph import policy, prompts
from app.graph.ports import (
    CalendarError,
    ChatMessage,
    Deps,
    HandoffSheet,
    LLMError,
    MessageBlockedError,
    Passage,
)
from app.graph.state import Action, Decision, Qualification, SalesAgentState, TraceEntry

logger = logging.getLogger(__name__)

Update = dict[str, Any]

# Action recommandée au conseiller selon le motif du transfert (F-21).
RECOMMENDED_ACTIONS = {
    "question_hors_base": "Répondre à la question du prospect, absente de la base de connaissances",
    "demande_conseiller": "Reprendre la conversation : le prospect demande un échange humain",
    "situation_sensible": "Reprendre la conversation avec prudence : situation sensible détectée",
    "incertitude": "Relire le dernier message et clarifier la demande du prospect",
    "llm_indisponible": "Répondre au dernier message : l'assistant n'a pas pu le traiter",
    "agenda_indisponible": "Proposer un rendez-vous manuellement : l'agenda est indisponible",
    "aucun_creneau": "Proposer un rendez-vous manuellement : aucun créneau disponible",
    "reservation_impossible": "Confirmer le rendez-vous manuellement : la réservation a échoué",
    "reponse_non_verifiable": "Répondre au prospect : la réponse de l'assistant était invérifiable",
}
HANDOFF_MESSAGE = (
    "Je transmets votre demande à un conseiller de DATUM Academy, qui reprendra la "
    "conversation avec vous."
)
NUMBER_OF_SLOTS = 3


def _t(node: str, summary: str) -> list[TraceEntry]:
    logger.info("agent.%s : %s", node, summary)
    return [TraceEntry(node=node, summary=summary)]


class WorkflowNodes:
    def __init__(self, deps: Deps) -> None:
        self.deps = deps

    # --- Chargement et contexte ---

    async def load_prospect(self, state: SalesAgentState) -> Update:
        ctx = await self.deps.gateway.load_context(state["prospect_id"], state["conversation_id"])
        return {
            "ctx": ctx,
            "trace": _t(
                "load_prospect",
                f"prospect {ctx.prospect_id}, étape {ctx.stage.value if ctx.stage else '-'}, "
                f"score {ctx.total_score}, {len(ctx.history)} message(s) d'historique",
            ),
        }

    async def identify_context(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        # F-08 : on répond sur le canal où la conversation a lieu.
        return {
            "answer_channel": ctx.channel,
            "target_code": ctx.target_code,
            "trace": _t(
                "identify_context",
                f"cible {ctx.target_code or '-'}, campagne {ctx.campaign_name or '-'}, "
                f"source {ctx.source_name or '-'}, canal {ctx.channel}",
            ),
        }

    async def enrich_prospect(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        profile = dict(ctx.profile)
        missing = policy.missing_fields(profile, state.get("target_code"))
        return {
            "profile": profile,
            "missing_fields": missing,
            "trace": _t(
                "enrich_prospect",
                f"profil connu : {sorted(k for k, v in profile.items() if v)}, "
                f"à compléter : {missing}",
            ),
        }

    # --- Qualification et score ---

    async def qualify_prospect(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        text = state.get("inbound_text", "")
        if state["trigger"] == "first_contact" or not text.strip():
            return {
                "qualification": None,
                "risk_alerts": [],
                "llm_failed": False,
                "trace": _t("qualify_prospect", "premier contact : rien à qualifier"),
            }

        alerts = policy.sensitive_alerts(text)
        # Filet de sécurité : une demande d'arrêt est détectée sans dépendre du modèle (S-03).
        if policy.is_opt_out(text):
            q = Qualification(intent="opt_out", confidence=1.0)
            return {
                "qualification": q,
                "risk_alerts": alerts,
                "llm_failed": False,
                "trace": _t("qualify_prospect", "demande d'arrêt détectée (mots-clés)"),
            }

        system = prompts.qualification_system(ctx, state["profile"], ctx.pending_slots)
        try:
            q = await self.deps.llm.extract(system, prompts.to_chat(ctx.history), Qualification)
        except LLMError as exc:
            logger.warning("Qualification impossible (%s) : %s", type(exc).__name__, exc)
            return {
                "qualification": None,
                "risk_alerts": alerts,
                "llm_failed": True,
                "trace": _t(
                    "qualify_prospect",
                    f"modèle indisponible : {type(exc).__name__} — {str(exc)[:200]}",
                ),
            }

        profile = dict(state["profile"])
        updates = {k: v for k, v in q.profile_updates().items() if profile.get(k) != v}
        if updates:
            await self.deps.gateway.save_profile(ctx.prospect_id, updates)
            profile.update(updates)
        missing = policy.missing_fields(profile, state.get("target_code"))
        return {
            "qualification": q,
            "profile": profile,
            "missing_fields": missing,
            "risk_alerts": alerts,
            "llm_failed": False,
            "trace": _t(
                "qualify_prospect",
                f"intention {q.intent}, sentiment {q.sentiment}, confiance {q.confidence:.2f}, "
                f"profil enrichi : {sorted(updates)}",
            ),
        }

    async def calculate_score(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        if ctx.membership_id is None:
            return {
                "interest_score": ctx.interest_score,
                "fit_score": ctx.fit_score,
                "total_score": ctx.total_score,
                "interest_level": ctx.interest_level,
                "trace": _t("calculate_score", "prospect sans campagne : pas de score"),
            }
        was_incomplete = bool(policy.missing_fields(ctx.profile, state.get("target_code")))
        now_complete = not state["missing_fields"]
        signals = policy.signals_from(
            state.get("qualification"),
            inbound=state["trigger"] == "inbound_message",
            profile_just_completed=was_incomplete and now_complete,
        )
        if not signals:
            return {
                "interest_score": ctx.interest_score,
                "fit_score": ctx.fit_score,
                "total_score": ctx.total_score,
                "interest_level": ctx.interest_level,
                "trace": _t("calculate_score", "aucun signal : score inchangé"),
            }
        snap = await self.deps.gateway.apply_signals(ctx.membership_id, signals)
        detail = "; ".join(f"{c.score_type.value} {c.points:+d} ({c.reason})" for c in snap.changes)
        return {
            "interest_score": snap.interest,
            "fit_score": snap.fit,
            "total_score": snap.total,
            "interest_level": snap.level,
            "trace": _t(
                "calculate_score",
                f"total {ctx.total_score} -> {snap.total}, niveau {snap.level} : "
                f"{detail or 'sans variation'}",
            ),
        }

    async def decide_next_action(self, state: SalesAgentState) -> Update:
        decision: Decision = policy.decide(state)
        return {
            "decision": decision,
            "trace": _t("decide_next_action", f"{decision.action.value} : {decision.reason}"),
        }

    # --- Actions ---

    async def generate_response(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        decision = state["decision"]
        mode = "nurture" if decision.action is Action.NURTURE else "continue"
        text = state.get("inbound_text", "")
        q = state.get("qualification")

        query = text if text.strip() else (ctx.campaign_name or "")
        passages: list[Passage] = await self.deps.knowledge.search(query, state.get("target_code"))
        asks_catalogue = q is not None and q.asks_catalogue
        if q is not None and q.intent == "question" and not passages and not asks_catalogue:
            # F-20 / NF-10 : question hors base de connaissances -> on ne devine pas.
            return {
                "needs_human": True,
                "handoff_reason": "question_hors_base",
                "trace": _t("generate_response", "question sans extrait validé : transfert"),
            }

        system = prompts.reply_system(
            ctx, state["profile"], passages, state.get("missing_fields", []), mode=mode
        )
        messages = prompts.to_chat(ctx.history) or [
            ChatMessage(
                role="user", content="(le prospect vient d'arriver : écris le premier message)"
            )
        ]
        sources = [p.text for p in passages] + [m.content for m in ctx.history]
        sources += [ctx.campaign_name or "", ctx.source_name or "", prompts.CATALOGUE]

        try:
            reply = (await self.deps.llm.generate(system, messages)).strip()
            claims = policy.ungrounded_claims(reply, sources)
            if claims:  # un seul nouvel essai, plus strict
                reply = (
                    await self.deps.llm.generate(
                        system + prompts.strict_retry_note(claims), messages
                    )
                ).strip()
                claims = policy.ungrounded_claims(reply, sources)
        except LLMError as exc:
            logger.warning("Rédaction impossible (%s) : %s", type(exc).__name__, exc)
            return {
                "needs_human": True,
                "handoff_reason": "llm_indisponible",
                "llm_failed": True,
                "trace": _t(
                    "generate_response",
                    f"modèle indisponible : {type(exc).__name__} — {str(exc)[:200]}",
                ),
            }
        if claims or not reply:
            return {
                "needs_human": True,
                "handoff_reason": "reponse_non_verifiable",
                "trace": _t(
                    "generate_response",
                    f"réponse rejetée (infos non sourcées : {claims or 'vide'})",
                ),
            }
        return {
            "reply_text": reply,
            "reply_metadata": {"mode": mode, "sources": [p.source for p in passages]},
            "needs_human": False,
            "trace": _t(
                "generate_response",
                f"réponse générée ({len(reply.split())} mots, {len(passages)} extrait(s))",
            ),
        }

    async def send_message(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        text = state.get("reply_text")
        if not text:
            return {"trace": _t("send_message", "aucun message à envoyer")}
        try:
            await self.deps.messenger.send(ctx, text, state.get("reply_metadata", {}))
        except MessageBlockedError as exc:
            return {
                "reply_text": None,
                "outcome": "blocked",
                "trace": _t("send_message", f"envoi refusé : {exc}"),
            }
        return {"trace": _t("send_message", f"message enregistré sur le canal {ctx.channel}")}

    async def schedule_followup(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        if state.get("outcome") == "blocked":
            return {"trace": _t("schedule_followup", "pas de relance : envoi refusé")}
        q = state.get("qualification")
        declined = q is not None and q.intent == "meeting_declined"
        delay = policy.follow_up_delay(state.get("interest_level"), declined=declined)
        reason = (
            "Rendez-vous refusé : relance" if declined else "Entretien d'un prospect peu engagé"
        )
        await self.deps.gateway.schedule_follow_up(
            ctx.prospect_id, ctx.membership_id, state["answer_channel"], delay, reason
        )
        return {
            "followup_scheduled": True,
            "trace": _t("schedule_followup", f"relance dans {delay.days} jour(s) : {reason}"),
        }

    async def get_calendar_slots(self, state: SalesAgentState) -> Update:
        try:
            slots = await self.deps.calendar.get_available_slots(NUMBER_OF_SLOTS)
        except CalendarError as exc:
            return {
                "slots": [],
                "needs_human": True,
                "handoff_reason": "agenda_indisponible",
                "trace": _t("get_calendar_slots", f"agenda indisponible : {exc}"),
            }
        if not slots:
            return {
                "slots": [],
                "needs_human": True,
                "handoff_reason": "aucun_creneau",
                "trace": _t("get_calendar_slots", "aucun créneau disponible"),
            }
        return {
            "slots": slots,
            "needs_human": False,
            "trace": _t("get_calendar_slots", f"{len(slots)} créneau(x) réellement disponible(s)"),
        }

    async def propose_meeting(self, state: SalesAgentState) -> Update:
        """Message déterministe : seuls des créneaux réels de l'agenda sont cités (NF-10)."""
        ctx = state["ctx"]
        slots = state["slots"]
        lines = "\n".join(f"{i}. {prompts.format_slot(s)}" for i, s in enumerate(slots, start=1))
        text = (
            f"{prompts.greeting(ctx)}\nVoici des créneaux disponibles pour échanger avec un "
            f"conseiller de DATUM Academy :\n{lines}\nRépondez avec le numéro du créneau qui vous "
            "convient."
        )
        metadata = {
            "mode": "meeting_proposal",
            "proposed_slots": [
                {"id": s.id, "start": s.start.isoformat(), "end": s.end.isoformat()} for s in slots
            ],
        }
        return {
            "reply_text": text,
            "reply_metadata": metadata,
            "trace": _t("propose_meeting", f"{len(slots)} créneau(x) proposé(s)"),
        }

    async def book_meeting(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        q = state["qualification"]
        assert q is not None and q.chosen_slot is not None  # noqa: S101 - garanti par decide()
        slot = ctx.pending_slots[q.chosen_slot - 1]
        try:
            meeting = await self.deps.calendar.book(slot, ctx.first_name)
        except CalendarError as exc:
            return {
                "needs_human": True,
                "handoff_reason": "reservation_impossible",
                "trace": _t("book_meeting", f"réservation impossible : {exc}"),
            }
        appointment_id = await self.deps.gateway.create_appointment(
            ctx.prospect_id, ctx.advisor_id, meeting
        )
        text = f"{prompts.greeting(ctx)}\nC'est noté : rendez-vous {prompts.format_slot(slot)}."
        if meeting.meeting_url:
            text += f"\nLien de connexion : {meeting.meeting_url}"
        return {
            "appointment_id": appointment_id,
            "needs_human": False,
            "reply_text": text,
            "reply_metadata": {"mode": "meeting_confirmation", "appointment_id": appointment_id},
            "trace": _t("book_meeting", f"rendez-vous {appointment_id} créé ({slot.id})"),
        }

    # --- Transfert, désinscription, clôture ---

    async def human_handoff(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        reason = state.get("handoff_reason") or self._reason_from_decision(state)
        q = state.get("qualification")
        text = state.get("inbound_text", "")
        history = [
            {
                "role": m.role,
                "content": m.content,
                "at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in ctx.history[-10:]
        ]
        sheet = HandoffSheet(
            reason=reason,
            identity={
                "first_name": ctx.first_name,
                "last_name": ctx.last_name,
                "email": ctx.email,
                "phone": ctx.phone,
            },
            campaign=ctx.campaign_name,
            source=ctx.source_name,
            channel=ctx.channel,
            summary=await self._summary(state),
            history=history,
            score={
                "interest": state.get("interest_score", ctx.interest_score),
                "fit": state.get("fit_score", ctx.fit_score),
                "total": state.get("total_score", ctx.total_score),
                "level": state.get("interest_level", ctx.interest_level),
            },
            qualification={
                "intent": q.intent if q else None,
                "sentiment": q.sentiment if q else None,
                "profile": state.get("profile", ctx.profile),
                "missing": state.get("missing_fields", []),
            },
            pending_question=text
            if q is not None and q.intent in ("question", "needs_advisor")
            else None,
            recommended_action=RECOMMENDED_ACTIONS.get(reason, "Reprendre la conversation"),
        )
        await self.deps.gateway.save_handoff(ctx.conversation_id, sheet)
        update: Update = {
            "handoff_reason": reason,
            "needs_human": True,
            "reply_text": HANDOFF_MESSAGE,
            "reply_metadata": {"mode": "handoff", "reason": reason},
            "trace": _t("human_handoff", f"transfert au conseiller : {reason}"),
        }
        try:
            await self.deps.messenger.send(ctx, HANDOFF_MESSAGE, update["reply_metadata"])
        except MessageBlockedError:
            update["reply_text"] = None
        return update

    @staticmethod
    def _reason_from_decision(state: SalesAgentState) -> str:
        if state.get("llm_failed"):
            return "llm_indisponible"
        if state.get("risk_alerts"):
            return "situation_sensible"
        q = state.get("qualification")
        if q is not None and q.confidence < policy.MIN_CONFIDENCE:
            return "incertitude"
        return "demande_conseiller"

    async def _summary(self, state: SalesAgentState) -> str:
        """Résumé pour le conseiller : par le modèle si possible, sinon déterministe."""
        ctx = state["ctx"]
        fallback = (
            f"{ctx.first_name or 'Le prospect'} ({ctx.target_code or 'cible inconnue'}), "
            f"campagne {ctx.campaign_name or '-'}, "
            f"score {state.get('total_score', ctx.total_score)}. "
            f"Dernier message : « {state.get('inbound_text', '')[:300]} »"
        )
        if state.get("llm_failed") or not ctx.history:
            return fallback
        try:
            summary = await self.deps.llm.generate(
                "Résume en 3 phrases maximum, pour un conseiller commercial, cette conversation "
                "avec un prospect : ce qu'il cherche, ce qu'il a déjà dit, ce qui est en attente. "
                "N'ajoute aucune information absente de la conversation.",
                prompts.to_chat(ctx.history),
            )
            return summary.strip() or fallback
        except LLMError:
            return fallback

    async def handle_opt_out(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        await self.deps.gateway.record_opt_out(ctx.prospect_id, ctx.channel, "agent_detection")
        return {
            "opted_out": True,
            "reply_text": None,
            "trace": _t("handle_opt_out", "opt-out enregistré, relances annulées, plus de message"),
        }

    async def close_conversation(self, state: SalesAgentState) -> Update:
        ctx = state["ctx"]
        decision = state["decision"]
        await self.deps.gateway.close_conversation(ctx.conversation_id, decision.reason)
        return {
            "reply_text": None,
            "trace": _t("close_conversation", f"conversation clôturée : {decision.reason}"),
        }

    async def finalize(self, state: SalesAgentState) -> Update:
        """Applique le changement d'étape décidé, avec sa justification (F-13)."""
        ctx = state["ctx"]
        decision = state["decision"]
        action = decision.action
        if state.get("needs_human") and action is not Action.HUMAN_HANDOFF:
            action = Action.HUMAN_HANDOFF  # un noeud a demandé le transfert en cours de route
        outcome = state.get("outcome") or action.value
        stage_after = ctx.stage.value if ctx.stage else None
        if ctx.membership_id is not None and ctx.stage is not None:
            already_opted_out = ctx.consent_status == "opted_out" and action is Action.CLOSE
            change = policy.stage_for(
                action,
                ctx.stage,
                qualification_complete=not state.get("missing_fields", ["x"]),
                first_contact=state["trigger"] == "first_contact",
            )
            if change is not None and state.get("outcome") != "blocked" and not already_opted_out:
                stage, reason = change
                await self.deps.gateway.change_stage(ctx.membership_id, stage, reason)
                stage_after = stage.value
        return {
            "outcome": outcome,
            "stage_before": ctx.stage.value if ctx.stage else None,
            "stage_after": stage_after,
            "trace": _t(
                "finalize",
                f"issue {outcome}, étape {ctx.stage and ctx.stage.value} -> {stage_after}",
            ),
        }
