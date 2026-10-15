"""Les consignes données au modèle : contenu vérifié, car elles pilotent le comportement réel."""

import re

from app.graph import prompts
from app.graph.ports import HistoryMessage, ProspectContext
from app.models.enums import ConversionStage


def ctx(history=None, target="ebihar_students"):
    return ProspectContext(
        prospect_id=1, conversation_id="c", channel="email", first_name="Camille", last_name=None,
        target_code=target, campaign_name="eBIHAR", source_name=None, membership_id=1,
        stage=ConversionStage.NEW, interest_score=0, fit_score=0, total_score=0,
        interest_level=None, advisor_id=None, consent_status="unknown", profile={},
        history=history or [], pending_slots=[],
    )  # fmt: skip


def reply(history=None, **kw):
    return prompts.reply_system(
        ctx(history), {}, kw.get("passages", []), kw.get("missing", []), mode="continue"
    )


def test_catalogue_lists_the_three_programmes_without_any_figure():
    for name in ("eBIHAR", "Les Compagnons", "Master eBIHAR"):
        assert name in prompts.CATALOGUE
    assert not re.search(r"\d", prompts.CATALOGUE)  # NF-10 : aucun prix, durée ni date en dur
    assert prompts.CATALOGUE in reply()


def test_prompts_use_correct_french_for_the_topic():
    for target in prompts.PROGRAMS:
        text = prompts.reply_system(ctx(target=target), {}, [], [], mode="continue")
        text += prompts.qualification_system(ctx(target=target), {}, [])
        assert " à le " not in text and " de le " not in text


def test_the_model_is_told_not_to_expose_its_internals_or_over_apologise():
    system = reply()
    assert "base de connaissances »" in system and "Ne mentionne jamais" in system
    assert "sans t'excuser" in system


def test_no_second_greeting_or_second_introduction_once_the_agent_has_spoken():
    first = reply()
    assert "ne salue pas" not in first  # premier message : on se présente
    ongoing = reply([HistoryMessage("prospect", "bonjour"), HistoryMessage("agent", "Bonjour !")])
    assert "ne salue pas à nouveau" in ongoing and "ne répète pas que tu es une IA" in ongoing
    only_prospect = reply([HistoryMessage("prospect", "bonjour")])
    assert "ne salue pas" not in only_prospect  # l'agent n'a encore rien dit


def test_qualification_prompt_separates_meeting_requests_from_asking_for_a_human():
    system = prompts.qualification_system(ctx(), {}, [])
    assert "rendez-vous avec un conseiller" in system and "= meeting_request" in system
    assert "TOUT DE SUITE" in system and "asks_catalogue" in system
    assert "Une demande de rendez-vous ne l'exige pas" in system


def test_known_contact_data_never_reaches_the_prompts():
    c = ctx()
    c.email, c.phone = "secret@exemple.fr", "0611223344"
    text = prompts.reply_system(c, {}, [], [], mode="continue")
    text += prompts.qualification_system(c, {}, [])
    assert "secret@exemple.fr" not in text and "0611223344" not in text
