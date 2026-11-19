"""Règles de décision du workflow : pures, déterministes, sans appel au modèle de langage.

Le modèle de langage *lit* le message (intention, informations de profil) et *rédige* ;
c'est ce module qui *décide*. Chaque décision porte sa justification (OB-05, NF-04) et les
seuils sont des valeurs de conception ajustables après validation métier.
"""

import re
import unicodedata
from datetime import UTC, datetime, timedelta
from typing import Any

from app.graph.ports import HistoryMessage, PolicyTuning
from app.graph.state import Action, Decision, Qualification, SalesAgentState
from app.models.enums import ConversionStage, ScoringSignal

# --- Seuils (valeurs de conception) ---

PROPOSE_MEETING_MIN_SCORE = 50  # score total à partir duquel on propose un rendez-vous (F-18)
NURTURE_MAX_SCORE = 24  # en dessous : prospect froid, on entretient sans insister
MIN_CONFIDENCE = 0.5  # en dessous : lecture du modèle trop incertaine, on transfère (F-20)
# Délai minimal avant un créneau pour le réserver : un créneau passé, ou trop proche, est reproposé
# (AUDIT-BIZ-001).
SLOT_MIN_NOTICE = timedelta(minutes=15)

# Grille de qualification par cible (F-09, décisions D-33 et D-37) : une question à la fois,
# jamais répétée, dans l'ordre de l'entonnoir : le projet d'abord (question ouverte), puis la
# situation, la rentrée visée et le lieu ou le format (questions alternatives). eBIHAR se suit en
# ligne : le format ne se demande pas, la situation (en études, en poste) le remplace.
REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "ebihar_students": ("goal", "study_level", "current_situation", "start_term"),
    "compagnons_pros": ("goal", "current_situation", "start_term", "location"),
    "master_candidates": ("goal", "study_level", "start_term", "location"),
    "master_companies": ("company_need", "availability"),
}
DEFAULT_REQUIRED = ("goal",)

FIELD_LABELS = {
    "study_level": "son niveau d'études",
    "field_of_study": "son domaine d'études",
    "current_situation": "sa situation actuelle (en études ou en poste)",
    "goal": "ce qu'il ou elle recherche (son projet)",
    "availability": "ses disponibilités ou l'échéance visée",
    "company_need": "les profils ou compétences recherchés par l'entreprise",
    "start_term": "la rentrée qu'il ou elle vise",
    "location": "le lieu ou le format souhaité (ville, sur place ou à distance)",
}


def now() -> datetime:
    """Heure courante (remplaçable dans les tests)."""
    return datetime.now(UTC)


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


# Demande sur ses données personnelles (effacement, accès : RGPD, art. 15 à 17) : un humain doit la
# traiter dans le délai légal, même si l'agent a déjà enregistré la désinscription.
_PERSONAL_DATA = [
    r"donnees personnelles",
    r"(supprim|effac)\w* (toutes )?mes donnees",
    r"\brgpd\b",
    r"droit (a l'oubli|d'acces|a l'effacement)",
]


# « Je parle à un robot ? » : une question sur l'interlocuteur, à laquelle l'agent répond
# franchement (D-32), pas une demande de conseiller.
_ASKS_ABOUT_AGENT = re.compile(
    r"\b(robot|bot|chatbot|une ia|l.ia|intelligence artificielle|une machine"
    r"|vraie personne|un humain|une personne reelle)\b"
)
_DEMANDS_HUMAN = re.compile(
    r"(parler|echanger|discuter) (a|avec) (un|une|quelqu.un|le|la) ?(humain|conseill|personne|vrai)"
    r"|passez.moi|je (veux|voudrais|prefere|souhaite) (un|une|parler a un) ?(humain|conseill)"
)
# Question qui annonce une décision : admission, candidature, inscription, rentrée.
_NEXT_STEP = re.compile(
    r"admission|admis\b|candidat|inscri|rentree|dossier|date limite|postuler|commencer"
    r"|demarr|entretien|prochaine session|quand (ca|cela) commence"
)


def asks_about_agent(text: str) -> bool:
    t = normalize(text)
    return "?" in text and bool(_ASKS_ABOUT_AGENT.search(t)) and not _DEMANDS_HUMAN.search(t)


def asks_next_step(text: str) -> bool:
    return bool(_NEXT_STEP.search(normalize(text)))


def asks_about_personal_data(text: str) -> bool:
    t = normalize(text)
    return any(re.search(p, t) for p in _PERSONAL_DATA)


# Renvoi vers un conseiller écrit sans le signal `[CONSEILLER]` (« je préfère laisser un conseiller
# vous apporter cette précision », « un conseiller vous précisera… ») : la réponse manque, il faut
# un vrai transfert pour tenir la promesse (D-34).
_INFO_VERBS = r"(donn|precis|apport|indiqu|confirm|communiqu|detaill|repond|expliqu|renseign)"
_ADVISOR = r"\b(un|le|votre|nos|des) conseillers?(?: [\w.]+){0,3}? "
_PRONOUNS = r"(vous |nous )?(la |le |les |l.|en |y )?"
_DEFERS = re.compile(
    r"laisser (a )?(un|le|votre|nos) conseill"
    rf"|{_ADVISOR}{_PRONOUNS}{_INFO_VERBS}(era|eront|ra|ront)\b"
    rf"|{_ADVISOR}(pourra|pourront|saura|sauront|va|vont) {_PRONOUNS}{_INFO_VERBS}(er|re)\b"
    r"|je n.ai pas (cette |l.|d.|de )?(information|precision|reponse)"
    r"|je ne dispose pas (de cette|de l.|d.)"
)


def defers_to_advisor_in_words(reply: str) -> bool:
    """Le message renvoie une information à un conseiller, en toutes lettres."""
    return bool(_DEFERS.search(normalize(reply)))


def question_unanswered(
    history: list[HistoryMessage], qualification: Qualification | None, inbound: str
) -> bool:
    """Le dernier message de l'agent posait une question et le prospect y a répondu par une autre
    question, sans rien dire de nouveau sur lui : reposer la même question serait insistant
    (D-34), on la garde pour le message suivant."""
    if "?" not in inbound:
        return False  # « d'accord », « bonjour » : la question peut être reposée
    last = next((m for m in reversed(history) if m.role != "prospect"), None)
    if last is None or "?" not in last.content:
        return False
    return qualification is None or not qualification.profile_updates()


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


# Formules qui ne visent que les messages de l'école : jamais ambiguës. Les autres (« stop »,
# « désinscrire », « unsubscribe ») peuvent parler d'autre chose dans un long message ou une
# question : « Comment me désinscrire de mon école actuelle ? » (AUDIT-BIZ-004).
_OPT_OUT_WEAK = (r"\bstop\b", r"\bunsubscribe\b", r"desinscri")
_OPT_OUT_EXPLICIT = [p for p in _OPT_OUT if p not in _OPT_OUT_WEAK]
AMBIGUOUS_MIN_WORDS = 12


def opt_out_is_ambiguous(text: str) -> bool:
    """Demande d'arrêt à faire vérifier par un conseiller. Elle reste enregistrée tout de suite :
    la vérification ne sert qu'à rétablir un consentement retiré à tort."""
    t = normalize(text)
    if not is_opt_out(text) or any(re.search(p, t) for p in _OPT_OUT_EXPLICIT):
        return False
    return "?" in t or len(t.split()) >= AMBIGUOUS_MIN_WORDS


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


DEFAULT_TUNING = PolicyTuning(
    propose_meeting_min_score=PROPOSE_MEETING_MIN_SCORE,
    nurture_max_score=NURTURE_MAX_SCORE,
    min_confidence=MIN_CONFIDENCE,
)


def decide(state: SalesAgentState, tuning: PolicyTuning = DEFAULT_TUNING) -> Decision:
    """Choisit la prochaine action. L'ordre des règles est l'ordre de priorité ; les seuils viennent
    des Paramètres (`tuning`, décision D-27)."""
    min_confidence = tuning.min_confidence
    ctx = state["ctx"]
    q = state.get("qualification")
    total = state.get("total_score", ctx.total_score)
    missing = state.get("missing_fields", [])
    stage = ctx.stage

    # 1. Désinscription : prioritaire sur tout (S-03).
    # Un STOP est traité en premier, même si l'arrêt a déjà été enregistré à l'arrivée du message
    # (opération idempotente) : la conversation est alors close et le prospect sort du pipeline.
    if q is not None and q.intent == "opt_out":
        return Decision(Action.OPT_OUT, "Demande d'arrêt des communications")
    if ctx.consent_status == "opted_out":
        return Decision(Action.CLOSE, "Le prospect s'est déjà désinscrit : aucune communication")

    # Relance programmée (le prospect est resté silencieux) : message d'entretien, rien à qualifier.
    if state.get("trigger") == "follow_up":
        return Decision(Action.NURTURE, "Relance programmée : message d'entretien")

    # 2. Cas qui exigent un humain, indépendamment du reste (F-20).
    if state.get("llm_failed"):
        return Decision(Action.HUMAN_HANDOFF, "Modèle de langage indisponible : transfert (NF-05)")
    if state.get("risk_alerts"):
        return Decision(Action.HUMAN_HANDOFF, "Situation sensible détectée")

    # 3. Une demande de rendez-vous passe avant la demande générique d'un conseiller : l'agent
    #    organise le rendez-vous lui-même (créneaux réels). Sans agenda, le transfert a lieu
    #    juste après (motif « agenda_non_configure » ou « agenda_indisponible »), donc le prospect
    #    n'est jamais bloqué.
    asks_human = q is not None and (q.needs_human or q.intent == "needs_advisor")
    wants_meeting = q is not None and (
        q.intent == "meeting_request"
        or (asks_human and mentions_meeting(state.get("inbound_text", "")))
    )
    if (
        wants_meeting
        and q is not None
        and q.confidence >= min_confidence
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
        if q.confidence < min_confidence:
            return Decision(Action.HUMAN_HANDOFF, "Incertitude élevée sur la demande du prospect")

    # 3. Fin de parcours sans relance.
    if q is not None and q.intent == "not_interested":
        return Decision(Action.CLOSE, "Le prospect n'est pas intéressé : aucune relance")

    # 4. Rendez-vous.
    if q is not None and q.intent == "slot_choice":
        slots = ctx.pending_slots
        if q.chosen_slot is not None and 1 <= q.chosen_slot <= len(slots):
            start = slots[q.chosen_slot - 1].start
            if (start if start.tzinfo else start.replace(tzinfo=UTC)) <= now() + SLOT_MIN_NOTICE:
                return Decision(
                    Action.PROPOSE_MEETING, "Créneau choisi déjà passé : nouvelle proposition"
                )
            return Decision(Action.BOOK_MEETING, f"Le prospect a choisi le créneau {q.chosen_slot}")
        return Decision(Action.PROPOSE_MEETING, "Créneau choisi non reconnu : nouvelle proposition")
    if stage not in _ADVANCED_STAGES:
        if q is not None and q.intent == "meeting_declined":
            return Decision(Action.NURTURE, "Rendez-vous refusé : relance programmée")
        # D-33 : grille complète et question qui annonce une décision (admission, rentrée,
        # candidature) -> l'agent répond, puis propose de lui-même de vrais créneaux, une fois.
        if (
            q is not None
            and q.intent in ("question", "interested")
            and not missing
            and ctx.pending_slots == []
            and stage is not ConversionStage.MEETING_PROPOSED
            and asks_next_step(state.get("inbound_text", ""))
        ):
            return Decision(
                Action.PROPOSE_MEETING,
                "Qualification complète et question sur l'admission, la rentrée ou la "
                "candidature : réponse puis créneaux",
                answer_first=True,
            )
        threshold = tuning.propose_meeting_min_score
        if total >= threshold and not missing and ctx.pending_slots == []:
            return Decision(
                Action.PROPOSE_MEETING,
                f"Score {total} >= {threshold} et qualification complète",
            )

    # 5. Prospect froid et peu engagé (message neutre) : on entretient sans insister (nurturing).
    #    Un prospect qui exprime de l'intérêt ou pose une question n'est jamais mis en veille.
    if (
        total <= tuning.nurture_max_score
        and state.get("trigger") == "inbound_message"
        and (q is None or q.intent == "other")
        and not asks_about_agent(state.get("inbound_text", ""))
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

# Trois familles d'affirmations (AUDIT-AI-001). Les prix et les conditions d'admission ou de
# financement ne peuvent venir que des sources validées (base de connaissances, catalogue) : un
# prospect qui écrit « c'est éligible au CPF ? » ne rend pas l'affirmation vraie. Les durées, dates,
# heures et niveaux d'études peuvent aussi venir de la conversation (le prospect parle de lui, ou un
# créneau déjà proposé).
_PRICE = re.compile(r"\d[\d  .,]*\s?(?:€|euros?|eur\b|%|pour ?cent)")
_SPELLED = (
    r"(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|seize|dix-huit|vingt"
    r"|vingt-quatre|trente|quarante-huit)"
)
_FACT = re.compile(
    r"\b\d{1,2}\s?[h:]\s?\d{2}\b"  # heure : 14h30, 14 h 30, 14:30
    r"|\d[\d  .,]*\s?(?:mois|ans?\b|annees?\b|semaines?|jours?|heures?|h\b)"
    r"|\b" + _SPELLED + r"\s(?:ans?|annees?|mois|semaines?|jours?|heures?)\b"
    r"|\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b"
    r"|\b\d{1,2}\s(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre"
    r"|decembre)\b"
    r"|\b20\d{2}\b"
    r"|\bbac\s?\+\s?\d\b"
)
# Liste à valider avec DATUM : termes qui engagent l'école sur l'admission ou le financement.
_TERMS = re.compile(
    r"\b(?:cpf|rncp|opco|france travail|pole emploi|gratuit(?:e|s|es)?|eligibles?|eligibilite"
    r"|bourses?|diplome d'etat|reconnue? par l'etat|certifiante?s?|accredite(?:e|s|es)?"
    r"|sans (?:le )?bac|frais d'inscription|frais de scolarite)\b"
)


# Marques d'accord d'un terme qui engage l'école (« gratuit », « gratuits », « gratuites »,
# « éligibles ») : le terme est sourcé si sa forme de base figure dans les sources.
_AGREEMENT = re.compile(r"(?:es|e|s)$")


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


_NUMBER_WORDS = {
    "deux": "2", "trois": "3", "quatre": "4", "cinq": "5", "six": "6", "sept": "7", "huit": "8",
    "neuf": "9", "dix": "10", "onze": "11", "douze": "12", "quinze": "15", "seize": "16",
    "dix-huit": "18", "vingt": "20", "vingt-quatre": "24", "trente": "30", "quarante-huit": "48",
}  # fmt: skip
_SPELLED_DURATION = re.compile(
    r"\b(" + "|".join(sorted(_NUMBER_WORDS, key=len, reverse=True)) + r")\s"
    r"(?=(?:ans?|annees?|mois|semaines?|jours?|heures?)\b)"
)


def _canonical(text: str) -> str:
    """Écritures équivalentes d'un montant ou d'une durée ramenées à une seule (texte déjà
    `normalize`) : « 7 000 euros », « 7.000 € » et « 7000 eur » deviennent « 7000€ » ;
    « 5 pour cent », « 5% » ; « deux ans », « 2 ans » (la source écrit souvent en chiffres)."""
    text = _SPELLED_DURATION.sub(lambda m: _NUMBER_WORDS[m.group(1)] + " ", text)
    text = re.sub(r"(?<=\d)[ .\u00a0\u202f](?=\d{3}(?!\d))", "", text)
    text = re.sub(r"(?<=\d)\s?(?:euros?|eur)\b", "€", text)
    return re.sub(r"(?<=\d)\s?pour ?cent\b", "%", text)


def _extra_terms(terms: tuple[str, ...]) -> re.Pattern[str] | None:
    """Termes ajoutés par l'administrateur, comparés sans accents ni majuscules."""
    words = [re.escape(normalize(t.strip())) for t in terms if t.strip()]
    return re.compile(r"\b(?:" + "|".join(words) + r")\b") if words else None


def ungrounded_claims(
    reply: str,
    sources: list[str],
    *,
    conversation: list[str] | None = None,
    extra_terms: tuple[str, ...] = (),
) -> list[str]:
    """Affirmations de la réponse absentes des sources (NF-10).

    `sources` : base de connaissances, catalogue validé, créneaux réels, campagne. `conversation` :
    messages déjà échangés, qui ne justifient que les durées, dates, heures et niveaux d'études,
    jamais un prix ni une condition d'admission ou de financement.
    """
    validated = _compact(_canonical(normalize(" ".join(sources))))
    everything = validated + _compact(_canonical(normalize(" ".join(conversation or []))))
    text = normalize(reply)
    bad = []
    checks = [(_PRICE, validated), (_TERMS, validated), (_FACT, everything)]
    if (extra := _extra_terms(extra_terms)) is not None:
        checks.append((extra, validated))
    for pattern, haystack in checks:
        for match in pattern.finditer(text):
            found = _compact(_canonical(match.group(0)))
            if pattern is _TERMS:
                found = _AGREEMENT.sub("", found)  # « gratuites » est sourcé par « gratuit »
            if found not in haystack:
                bad.append(match.group(0).strip())
    return list(dict.fromkeys(bad))
