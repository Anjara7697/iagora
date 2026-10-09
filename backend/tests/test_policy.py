from datetime import timedelta

import pytest
from app.graph import policy
from app.graph.ports import ProspectContext
from app.graph.prompts import format_slot
from app.graph.state import Action, Qualification
from app.models.enums import ConversionStage as S
from app.models.enums import ScoringSignal as Sig

from .fakes import make_slots


def ctx(**over):
    base = {
        "prospect_id": 1, "conversation_id": "c", "channel": "email", "first_name": "Jean",
        "last_name": None, "target_code": "ebihar_students", "campaign_name": "eBIHAR",
        "source_name": "LI", "membership_id": 1, "stage": S.NEW, "interest_score": 0,
        "fit_score": 0, "total_score": 0, "interest_level": "cold", "advisor_id": None,
        "consent_status": "unknown", "profile": {}, "history": [], "pending_slots": [],
    }  # fmt: skip
    return ProspectContext(**(base | over))


def state(q=None, total=0, missing=None, trigger="inbound_message", **ctx_over):
    return {
        "ctx": ctx(**ctx_over),
        "qualification": q,
        "total_score": total,
        "missing_fields": ["goal"] if missing is None else missing,
        "trigger": trigger,
        "risk_alerts": [],
        "llm_failed": False,
    }


# --- Détection par mots-clés ---


@pytest.mark.parametrize(
    "text",
    ["STOP", "Merci de me désinscrire", "ne me contactez plus", "Arrêtez de m'écrire svp",
     "je ne veux plus recevoir vos mails", "unsubscribe", "Retirez-moi de votre liste",
     "Ne m'écrivez plus", "Ne me relancez plus s'il vous plaît", "Cessez de m'envoyer des mails",
     "Je souhaite ne plus être contacté", "ARRÊTEZ DE ME CONTACTER"],
)  # fmt: skip
def test_opt_out_detected(text):
    assert policy.is_opt_out(text)


@pytest.mark.parametrize(
    "text", ["Bonjour", "Je voudrais plus d'informations", "Quand commence la formation ?"]
)
def test_normal_messages_are_not_opt_out(text):
    assert not policy.is_opt_out(text)


def test_sensitive_messages_flagged():
    assert policy.sensitive_alerts("Je vais déposer une plainte")
    assert policy.sensitive_alerts("J'ai un handicap, est-ce adapté ?")
    assert policy.sensitive_alerts("Je veux supprimer mes données personnelles")
    assert not policy.sensitive_alerts("Quels sont les débouchés ?")


# --- Profil ---


def test_missing_fields_depend_on_target_and_never_ask_known_data():
    assert policy.missing_fields({}, "ebihar_students") == ["study_level", "goal"]
    assert policy.missing_fields({"study_level": "Bac+3"}, "ebihar_students") == ["goal"]
    assert policy.missing_fields({"study_level": "x", "goal": "y"}, "ebihar_students") == []
    assert policy.missing_fields({"goal": "  "}, None) == ["goal"]
    assert policy.missing_fields({}, "compagnons_pros") == ["current_situation", "goal"]


# --- Signaux de score ---


def test_signals():
    assert policy.signals_from(None, inbound=False, profile_just_completed=False) == []
    assert policy.signals_from(None, inbound=True, profile_just_completed=False) == [
        Sig.MESSAGE_RECEIVED
    ]
    q = Qualification(intent="meeting_request", sentiment="positive")
    assert policy.signals_from(q, inbound=True, profile_just_completed=True) == [
        Sig.MESSAGE_RECEIVED, Sig.MEETING_REQUESTED, Sig.POSITIVE_SENTIMENT, Sig.PROFILE_COMPLETED,
    ]  # fmt: skip
    q = Qualification(intent="not_interested")
    assert Sig.NEGATIVE_SENTIMENT in policy.signals_from(
        q, inbound=True, profile_just_completed=False
    )
    q = Qualification(intent="question")
    assert Sig.QUESTION_ASKED in policy.signals_from(q, inbound=True, profile_just_completed=False)


# --- Décision (parcours type, CdC §6.2) ---


def test_opt_out_has_priority_over_everything():
    q = Qualification(intent="opt_out")
    assert policy.decide(state(q, total=90)).action is Action.OPT_OUT
    assert policy.decide(state(None, consent_status="opted_out")).action is Action.CLOSE


def test_human_handoff_cases():
    d = policy.decide(state(Qualification(intent="needs_advisor")))
    assert d.action is Action.HUMAN_HANDOFF
    assert (
        policy.decide(state(Qualification(intent="other", needs_human=True))).action
        is Action.HUMAN_HANDOFF
    )
    low = Qualification(intent="question", confidence=0.3)
    assert policy.decide(state(low)).action is Action.HUMAN_HANDOFF
    s = state(Qualification(intent="question"))
    s["llm_failed"] = True
    assert policy.decide(s).action is Action.HUMAN_HANDOFF
    s = state(Qualification(intent="question"))
    s["risk_alerts"] = ["plainte"]
    assert policy.decide(s).action is Action.HUMAN_HANDOFF


def test_cold_prospect_is_nurtured_hot_one_gets_a_meeting():
    assert policy.decide(state(Qualification(intent="other"), total=10)).action is Action.NURTURE
    # Un prospect qui montre de l'intérêt n'est jamais mis en veille, même avec un score bas.
    for intent in ("interested", "question"):
        assert policy.decide(state(Qualification(intent=intent), total=3)).action is (
            Action.CONTINUE_CONVERSATION
        )
    hot = state(Qualification(intent="interested"), total=60, missing=[])
    assert policy.decide(hot).action is Action.PROPOSE_MEETING
    # Score élevé mais qualification incomplète : on continue à qualifier d'abord.
    incomplete = state(Qualification(intent="interested"), total=60, missing=["goal"])
    assert policy.decide(incomplete).action is Action.CONTINUE_CONVERSATION
    mid = state(Qualification(intent="question"), total=30)
    assert policy.decide(mid).action is Action.CONTINUE_CONVERSATION


def test_explicit_meeting_request_and_refusal():
    q = Qualification(intent="meeting_request")
    assert policy.decide(state(q, total=5)).action is Action.PROPOSE_MEETING
    declined = policy.decide(state(Qualification(intent="meeting_declined"), total=70, missing=[]))
    assert declined.action is Action.NURTURE  # « rendez-vous refusé : relance programmée »
    gone = policy.decide(state(Qualification(intent="not_interested")))
    assert gone.action is Action.CLOSE


def test_slot_choice_books_only_a_proposed_slot():
    slots = make_slots(3)
    ok = state(Qualification(intent="slot_choice", chosen_slot=2), pending_slots=slots)
    assert policy.decide(ok).action is Action.BOOK_MEETING
    for bad in (None, 0, 4):
        s = state(Qualification(intent="slot_choice", chosen_slot=bad), pending_slots=slots)
        assert policy.decide(s).action is Action.PROPOSE_MEETING  # jamais de réservation hasardeuse


def test_advanced_prospects_are_not_pushed_back_to_a_meeting():
    s = state(
        Qualification(intent="meeting_request"), total=90, missing=[], stage=S.MEETING_SCHEDULED
    )
    assert policy.decide(s).action is Action.CONTINUE_CONVERSATION


def test_first_contact_continues_instead_of_nurturing():
    s = state(None, total=0, trigger="first_contact")
    assert policy.decide(s).action is Action.CONTINUE_CONVERSATION


def test_every_decision_is_justified():
    for q in (None, Qualification(intent="question"), Qualification(intent="opt_out")):
        assert policy.decide(state(q)).reason.strip()


# --- Étapes (F-13) ---


@pytest.mark.parametrize(
    ("action", "current", "expected"),
    [
        (Action.CONTINUE_CONVERSATION, S.NEW, S.IN_CONVERSATION),
        (Action.CONTINUE_CONVERSATION, S.IN_CONVERSATION, S.IN_CONVERSATION),
        (Action.NURTURE, S.NEW, S.TO_FOLLOW_UP),
        (Action.PROPOSE_MEETING, S.IN_CONVERSATION, S.MEETING_PROPOSED),
        (Action.BOOK_MEETING, S.MEETING_PROPOSED, S.MEETING_SCHEDULED),
        (Action.OPT_OUT, S.IN_CONVERSATION, S.LOST),
        (Action.CLOSE, S.IN_CONVERSATION, S.LOST),
        (Action.CONTINUE_CONVERSATION, S.TO_FOLLOW_UP, S.IN_CONVERSATION),  # il a répondu
        (Action.CONTINUE_CONVERSATION, S.LOST, S.IN_CONVERSATION),
    ],
)
def test_stage_transitions(action, current, expected):
    result = policy.stage_for(action, current, qualification_complete=False)
    if expected == current:
        assert result is None
    else:
        assert result is not None and result[0] is expected and result[1].strip()


def test_stages_never_go_backwards():
    for action in (Action.NURTURE, Action.CONTINUE_CONVERSATION, Action.PROPOSE_MEETING):
        for advanced in (S.MEETING_SCHEDULED, S.APPLIED, S.CONVERTED):
            assert policy.stage_for(action, advanced, qualification_complete=True) is None
    assert (
        policy.stage_for(Action.NURTURE, S.MEETING_PROPOSED, qualification_complete=False) is None
    )


def test_first_contact_and_qualification_stages():
    first = policy.stage_for(
        Action.CONTINUE_CONVERSATION, S.NEW, qualification_complete=False, first_contact=True
    )
    assert first is not None and first[0] is S.CONTACTED
    done = policy.stage_for(
        Action.CONTINUE_CONVERSATION, S.IN_CONVERSATION, qualification_complete=True
    )
    assert done is not None and done[0] is S.QUALIFIED


def test_follow_up_delays_are_shorter_for_engaged_prospects():
    assert policy.follow_up_delay("cold") == timedelta(days=7)
    assert policy.follow_up_delay("warm") == timedelta(days=3)
    assert policy.follow_up_delay("hot") == timedelta(days=1)
    assert policy.follow_up_delay(None, declined=True) == timedelta(days=2)


# --- Exactitude (NF-10) ---


@pytest.mark.parametrize(
    "reply",
    [
        "La formation coûte 4500 euros.",
        "Elle dure 18 mois.",
        "Le taux de réussite est de 95 %.",
        "La rentrée est le 15 septembre.",
        "Les inscriptions ferment le 12/06.",
        "Candidatez avant 2027.",
        "Les frais sont de 3 200 €.",
    ],
)
def test_invented_figures_are_caught(reply):
    assert policy.ungrounded_claims(reply, ["Le programme eBIHAR forme aux métiers de la data."])


def test_grounded_figures_are_accepted():
    sources = ["La formation dure 18 mois et coûte 4500 euros.", "Rentrée : 15 septembre"]
    assert policy.ungrounded_claims("Elle dure 18 mois et coûte 4 500 euros.", sources) == []
    assert policy.ungrounded_claims("La rentrée a lieu le 15 septembre.", sources) == []
    assert policy.ungrounded_claims("Bonjour Jean, je vous écoute.", []) == []


def test_slot_formatting_uses_paris_time():
    # 1er mars 2027 = lundi ; 13h UTC = 14h à Paris (hiver).
    assert format_slot(make_slots(1)[0]) == "lundi 1 mars à 14h00"
