"""Règles de décision du workflow : pures, déterministes, sans appel au modèle de langage.

Le modèle de langage *lit* le message (intention, informations de profil) et *rédige* ;
c'est ce module qui *décide*. Chaque décision porte sa justification (OB-05, NF-04) et les
seuils sont des valeurs de conception ajustables après validation métier.
"""

import re
import unicodedata
from datetime import timedelta
from typing import Any

from app.graph.state import Action, Decision, Qualification, SalesAgentState
from app.models.enums import ConversionStage, ScoringSignal

# --- Seuils (valeurs de conception) ---

PROPOSE_MEETING_MIN_SCORE = 50  # score total à partir duquel on propose un rendez-vous (F-18)
NURTURE_MAX_SCORE = 24  # en dessous : prospect froid, on entretient sans insister
MIN_CONFIDENCE = 0.5  # en dessous : lecture du modèle trop incertaine, on transfère (F-20)

# Informations de qualification attendues par cible (F-09) : peu de questions, jamais répétées.
REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "ebihar_students": ("study_level", "goal"),
    "compagnons_pros": ("current_situation", "goal"),
    "master_candidates": ("study_level", "availability"),
    "master_companies": ("company_need", "availability"),
}
DEFAULT_REQUIRED = ("goal",)

FIELD_LABELS = {
    "study_level": "son niveau d'études",
    "field_of_study": "son domaine d'études",
    "current_situation": "sa situation professionnelle actuelle",
    "goal": "ce qu'il ou elle recherche (son projet)",
    "availability": "ses disponibilités ou l'échéance visée",
    "company_need": "les profils ou compétences recherchés par l'entreprise",
}


def normalize(text: str) -> str:
    """Minuscules sans accents, pour comparer sans se soucier de la saisie."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


# --- Détection par mots-clés (filet de sécurité indépendant du modèle) ---

_OPT_OUT = [
    r"\bstop\b",
    r"\bunsubscribe\b",
    r"desinscri",
    r"ne (me |m')?(contactez|recontactez|relancez|ecrivez|envoyez|appelez|telephonez) plus",
    r"(arretez|cessez) de (me |m')?(contacter|ecrire|envoyer|relancer|appeler|telephoner)",
    r"ne plus (recevoir|etre contacte|me contacter|m'ecrire|m'envoyer)",
    r"(veux|souhaite|desire|voudrais) (ne )?plus (recevoir|etre contacte|etre relance)",
    r"retirez[- ]moi (de|des)",
    r"supprimez[- ]moi (de|des)",
]
_SENSITIVE = [
    r"\bplainte\b",
    r"reclamation",
    r"\bavocat\b",
    r"harcelement",
    r"discriminat",
    r"handicap",
    r"detresse",
    r"suicid",
    r"donnees personnelles",
    r"supprim\w+ mes donnees",
    r"\brgpd\b",
]


_MEETING = [r"rendez[- ]?vous", r"\brdv\b", r"creneau", r"disponibilites?\b"]


def mentions_meeting(text: str) -> bool:
    """Le message parle-t-il d'un rendez-vous ? Filet de sécurité quand le modèle hésite entre
    « veut un rendez-vous » et « veut un conseiller » : « un rendez-vous avec un conseiller » est
    d'abord une demande de rendez-vous, que l'agent sait organiser lui-même."""
    t = normalize(text)
    return any(re.search(p, t) for p in _MEETING)


def is_opt_out(text: str) -> bool:
    t = normalize(text)
    return any(re.search(p, t) for p in _OPT_OUT)


def sensitive_alerts(text: str) -> list[str]:
    t = normalize(text)
    return [p for p in _SENSITIVE if re.search(p, t)]


# --- Profil (F-09) ---


def required_fields(target_code: str | None) -> tuple[str, ...]:
    return REQUIRED_FIELDS.get(target_code or "", DEFAULT_REQUIRED)


def missing_fields(profile: dict[str, Any], target_code: str | None) -> list[str]:
    return [f for f in required_fields(target_code) if not str(profile.get(f) or "").strip()]


# --- Scoring (F-10) ---


def signals_from(
    qualification: Qualification | None,
    *,
    inbound: bool,
    profile_just_completed: bool,
) -> list[ScoringSignal]:
    """Convertit ce que le prospect a dit en signaux de score ; les points sont dans scoring.py."""
    if not inbound:
        return []
    signals = [ScoringSignal.MESSAGE_RECEIVED]
    if qualification is None:
        return signals
    intent = qualification.intent
    if intent == "question":
        signals.append(ScoringSignal.QUESTION_ASKED)
    if intent == "meeting_request":
        signals.append(ScoringSignal.MEETING_REQUESTED)
    if intent == "meeting_declined":
        signals.append(ScoringSignal.MEETING_DECLINED)
    if qualification.sentiment == "positive":
        signals.append(ScoringSignal.POSITIVE_SENTIMENT)
    elif qualification.sentiment == "negative" or intent == "not_interested":
        signals.append(ScoringSignal.NEGATIVE_SENTIMENT)
    if profile_just_completed:
        signals.append(ScoringSignal.PROFILE_COMPLETED)
    return signals


# --- Décision (§6.2 : parcours type d'un prospect) ---

_ADVANCED_STAGES = {
    ConversionStage.MEETING_SCHEDULED,
    ConversionStage.MEETING_DONE,
    ConversionStage.APPLIED,
    ConversionStage.CONVERTED,
}


def decide(state: SalesAgentState) -> Decision:
    """Choisit la prochaine action. L'ordre des règles est l'ordre de priorité."""
    ctx = state["ctx"]
    q = state.get("qualification")
    total = state.get("total_score", ctx.total_score)
    missing = state.get("missing_fields", [])
    stage = ctx.stage

    # 1. Désinscription : prioritaire sur tout (S-03).
    if ctx.consent_status == "opted_out":
        return Decision(Action.CLOSE, "Le prospect s'est déjà désinscrit : aucune communication")
    if q is not None and q.intent == "opt_out":
        return Decision(Action.OPT_OUT, "Demande d'arrêt des communications")

    # 2. Cas qui exigent un humain, indépendamment du reste (F-20).
    if state.get("llm_failed"):
        return Decision(Action.HUMAN_HANDOFF, "Modèle de langage indisponible : transfert (NF-05)")
    if state.get("risk_alerts"):
        return Decision(Action.HUMAN_HANDOFF, "Situation sensible détectée")

    # 3. Une demande de rendez-vous passe avant la demande générique d'un conseiller : l'agent
    #    organise le rendez-vous lui-même (créneaux réels). Sans agenda, le transfert a lieu
    #    juste après (motif « agenda_indisponible »), donc le prospect n'est jamais bloqué.
    asks_human = q is not None and (q.needs_human or q.intent == "needs_advisor")
    wants_meeting = q is not None and (
        q.intent == "meeting_request"
        or (asks_human and mentions_meeting(state.get("inbound_text", "")))
    )
    if (
        wants_meeting
        and q is not None
        and q.confidence >= MIN_CONFIDENCE
        and stage not in _ADVANCED_STAGES
    ):
        return Decision(Action.PROPOSE_MEETING, "Le prospect demande un rendez-vous")

    if q is not None:
        if q.intent == "needs_advisor":
            return Decision(Action.HUMAN_HANDOFF, "Le prospect demande explicitement un conseiller")
        if q.needs_human:
            return Decision(
                Action.HUMAN_HANDOFF, "Demande qui exige un conseiller (décision, cas particulier)"
            )
        if q.confidence < MIN_CONFIDENCE:
            return Decision(Action.HUMAN_HANDOFF, "Incertitude élevée sur la demande du prospect")

    # 3. Fin de parcours sans relance.
    if q is not None and q.intent == "not_interested":
        return Decision(Action.CLOSE, "Le prospect n'est pas intéressé : aucune relance")

    # 4. Rendez-vous.
    if q is not None and q.intent == "slot_choice":
        slots = ctx.pending_slots
        if q.chosen_slot is not None and 1 <= q.chosen_slot <= len(slots):
            return Decision(Action.BOOK_MEETING, f"Le prospect a choisi le créneau {q.chosen_slot}")
        return Decision(Action.PROPOSE_MEETING, "Créneau choisi non reconnu : nouvelle proposition")
    if stage not in _ADVANCED_STAGES:
        if q is not None and q.intent == "meeting_declined":
            return Decision(Action.NURTURE, "Rendez-vous refusé : relance programmée")
        if total >= PROPOSE_MEETING_MIN_SCORE and not missing and ctx.pending_slots == []:
            return Decision(
                Action.PROPOSE_MEETING,
                f"Score {total} >= {PROPOSE_MEETING_MIN_SCORE} et qualification complète",
            )

    # 5. Prospect froid et peu engagé (message neutre) : on entretient sans insister (nurturing).
    #    Un prospect qui exprime de l'intérêt ou pose une question n'est jamais mis en veille.
    if (
        total <= NURTURE_MAX_SCORE
        and state.get("trigger") == "inbound_message"
        and (q is None or q.intent == "other")
    ):
        return Decision(Action.NURTURE, f"Score faible ({total}) : entretien espacé")

    # 6. Sinon : on poursuit l'échange et on qualifie.
    return Decision(Action.CONTINUE_CONVERSATION, "Poursuite de l'échange et qualification")


# --- Étapes (F-13) ---

_RANK = {
    ConversionStage.NEW: 0,
    ConversionStage.TO_QUALIFY: 1,
    ConversionStage.CONTACTED: 2,
    ConversionStage.IN_CONVERSATION: 3,
    ConversionStage.QUALIFIED: 4,
    ConversionStage.MEETING_PROPOSED: 5,
    ConversionStage.MEETING_SCHEDULED: 6,
    ConversionStage.MEETING_DONE: 7,
    ConversionStage.APPLIED: 8,
    ConversionStage.CONVERTED: 9,
}
_REENGAGEABLE = {ConversionStage.TO_FOLLOW_UP, ConversionStage.LOST}


def _forward(current: ConversionStage | None, target: ConversionStage) -> bool:
    """On n'avance que vers l'avant ; un prospect « à relancer » ou « perdu » qui répond reprend."""
    if current is None:
        return False
    if current in _REENGAGEABLE:
        return target not in _REENGAGEABLE or target is ConversionStage.LOST
    if target in _REENGAGEABLE:
        return _RANK.get(current, 0) <= _RANK[ConversionStage.IN_CONVERSATION]
    return _RANK[target] > _RANK[current]


def stage_for(
    action: Action,
    current: ConversionStage | None,
    *,
    qualification_complete: bool,
    first_contact: bool = False,
) -> tuple[ConversionStage, str] | None:
    """Étape cible et justification, ou None si l'étape ne change pas."""
    target: ConversionStage | None = None
    reason = ""
    if action is Action.OPT_OUT:
        target, reason = ConversionStage.LOST, "Désinscription du prospect"
    elif action is Action.CLOSE and current != ConversionStage.LOST:
        target, reason = ConversionStage.LOST, "Prospect non intéressé"
    elif action is Action.BOOK_MEETING:
        target, reason = ConversionStage.MEETING_SCHEDULED, "Rendez-vous réservé"
    elif action is Action.PROPOSE_MEETING:
        target, reason = ConversionStage.MEETING_PROPOSED, "Créneaux proposés au prospect"
    elif action is Action.NURTURE:
        target, reason = ConversionStage.TO_FOLLOW_UP, "Relance programmée (entretien)"
    elif action is Action.CONTINUE_CONVERSATION:
        if first_contact:
            target, reason = ConversionStage.CONTACTED, "Premier message envoyé au prospect"
        elif qualification_complete and current is ConversionStage.IN_CONVERSATION:
            target, reason = ConversionStage.QUALIFIED, "Informations de qualification complètes"
        else:
            target, reason = ConversionStage.IN_CONVERSATION, "Échange en cours avec le prospect"
    if target is None or target == current or not _forward(current, target):
        return None
    return target, reason


def follow_up_delay(level: str | None, *, declined: bool = False) -> timedelta:
    """Relances espacées, plus rapprochées pour un prospect plus engagé (F-16)."""
    if declined:
        return timedelta(days=2)
    return {
        "very_hot": timedelta(days=1),
        "hot": timedelta(days=1),
        "warm": timedelta(days=3),
    }.get(level or "", timedelta(days=7))


# --- Exactitude (NF-10) : aucune information chiffrée non sourcée ---

_CLAIM = re.compile(
    r"\d[\d  .,]*\s?(?:€|euros?|eur\b|%|pour ?cent|mois|ans?\b|semaines?|jours?|heures?|h\b)"
    r"|\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b"
    r"|\b\d{1,2}\s(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre"
    r"|decembre)\b"
    r"|\b20\d{2}\b"
)


def ungrounded_claims(reply: str, sources: list[str]) -> list[str]:
    """Prix, durées, pourcentages ou dates de la réponse absents des sources fournies.

    Les sources sont la base de connaissances, les messages déjà échangés et les créneaux
    réels de l'agenda : tout chiffre avancé doit y figurer (NF-10).
    """
    haystack = re.sub(r"\s+", "", normalize(" ".join(sources)))
    bad = []
    for match in _CLAIM.finditer(normalize(reply)):
        token = re.sub(r"\s+", "", match.group(0))
        if token not in haystack:
            bad.append(match.group(0).strip())
    return bad
