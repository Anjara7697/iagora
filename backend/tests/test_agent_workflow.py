"""Scénarios du workflow agentique (CdC §12.2), joués de l'API jusqu'aux bases de données.

Le modèle de langage, l'agenda et la base de connaissances sont des doublures scénarisées :
on teste le *comportement du workflow* (décisions, garde-fous, traçabilité), pas Gemini.
"""

import ast
import pathlib
from types import SimpleNamespace

import pytest
from app.agents.defaults import RecordingMessenger, UnconfiguredCalendar
from app.api.dependencies import get_calendar, get_knowledge_base, get_language_model
from app.graph.builder import build_workflow
from app.graph.ports import Deps, LLMConfigError, LLMUnavailableError, Passage
from app.graph.state import Qualification
from app.main import app
from app.models import Appointment, ConsentEvent, FollowUp, Interaction, Prospect
from app.models.enums import FollowUpStatus, UserRole
from sqlalchemy import select

from .fakes import FakeCalendar, FakeKnowledge, FakeLLM

API = "/api/v1"
INTRO = "Bonjour Jean, merci pour votre message."


@pytest.fixture
def env(client):
    """Doublures du modèle, de l'agenda et de la base de connaissances."""
    e = SimpleNamespace(llm=FakeLLM(reply=INTRO), calendar=FakeCalendar(), kb=FakeKnowledge())
    app.dependency_overrides[get_language_model] = lambda: e.llm
    app.dependency_overrides[get_calendar] = lambda: e.calendar
    app.dependency_overrides[get_knowledge_base] = lambda: e.kb
    return e


async def lead(client, text="Bonjour", profile=None, **prospect):
    """Prospect eBIHAR rattaché à une campagne, avec une conversation et un message entrant."""
    camp = (
        await client.post(
            f"{API}/campaigns",
            json={
                "name": "Recrutement eBIHAR",
                "status": "active",
                "sources": [{"name": "LinkedIn", "type": "ads", "platform": "linkedin"}],
            },
        )
    ).json()
    payload = {
        "first_name": "Jean",
        "email": "jean.dupont@example.com",
        "phone": "0612345678",
        "channel": "email",
        "target_code": "ebihar_students",
        "campaign_id": camp["id"],
        "source_id": camp["sources"][0]["id"],
        "profile": profile or {},
    } | prospect
    created = (await client.post(f"{API}/prospects", json=payload)).json()["prospect"]
    pid, mid = created["id"], created["campaigns"][0]["id"]
    conv = (
        await client.post(f"{API}/conversations", json={"prospect_id": pid, "channel": "email"})
    ).json()
    cid = conv["conversation"]["id"]
    if text is not None:
        await say(client, cid, text)
    return pid, mid, cid


async def say(client, cid, text, role="prospect"):
    r = await client.post(
        f"{API}/conversations/{cid}/messages", json={"role": role, "content": text}
    )
    assert r.status_code == 201, r.text


async def run(client, cid):
    return await client.post(f"{API}/agent/runs", json={"conversation_id": cid})


async def conversation(client, cid):
    return (await client.get(f"{API}/conversations/{cid}")).json()


async def history(client, mid):
    return (await client.get(f"{API}/campaign-prospects/{mid}/history")).json()


async def membership(client, mid):
    return (await client.get(f"{API}/campaign-prospects/{mid}")).json()


# --- Scénario 1 : prospect froid -> qualification -> score faible -> nurturing ---


async def test_cold_prospect_is_nurtured(client, env, session_factory):
    pid, mid, cid = await lead(client, "Bonjour, je regardais un peu votre site.")
    r = await run(client, cid)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["action"] == "nurture" and out["reason"]
    assert out["reply"] == INTRO and out["handoff_reason"] is None

    conv = await conversation(client, cid)
    sent = conv["messages"][-1]
    assert sent["role"] == "agent" and sent["metadata"]["mode"] == "nurture"
    assert sent["metadata"]["delivery"] == "not_sent"  # enregistré, pas encore expédié

    assert (await membership(client, mid))["conversion_stage"] == "to_follow_up"
    async with session_factory() as s:
        follow_ups = (await s.scalars(select(FollowUp))).all()
    assert len(follow_ups) == 1 and follow_ups[0].status is FollowUpStatus.SCHEDULED
    assert follow_ups[0].campaign_prospect_id == mid

    scores = (await history(client, mid))["score_events"]
    assert scores and all(e["reason"] for e in scores)  # F-11 : chaque variation est justifiée
    assert "Le prospect a répondu" in {e["reason"] for e in scores}


# --- Scénario 2 : prospect chaud -> conversation -> rendez-vous ---


async def test_meeting_request_proposes_real_slots_then_books_the_chosen_one(
    client, env, session_factory
):
    pid, mid, cid = await lead(
        client,
        "Je voudrais prendre rendez-vous avec un conseiller.",
        profile={"study_level": "Bac+3", "goal": "devenir data analyst"},
    )
    env.llm.qualification = Qualification(intent="meeting_request", sentiment="positive")
    proposal = (await run(client, cid)).json()
    assert proposal["action"] == "propose_meeting"
    for expected in ("lundi 1 mars à 14h00", "mardi 2 mars à 14h00", "mercredi 3 mars à 14h00"):
        assert expected in proposal["reply"]  # uniquement des créneaux réels de l'agenda
    assert (await membership(client, mid))["conversion_stage"] == "meeting_proposed"
    stored = (await conversation(client, cid))["messages"][-1]
    assert [s["id"] for s in stored["metadata"]["proposed_slots"]] == ["slot-0", "slot-1", "slot-2"]

    await say(client, cid, "Le deuxième me convient.")
    env.llm.qualification = Qualification(intent="slot_choice", chosen_slot=2)
    booked = (await run(client, cid)).json()
    assert booked["action"] == "book_meeting"
    assert "mardi 2 mars à 14h00" in booked["reply"]
    assert "https://zoom.example/slot-1" in booked["reply"]
    assert [s.id for s in env.calendar.booked] == ["slot-1"]
    assert (await membership(client, mid))["conversion_stage"] == "meeting_scheduled"
    async with session_factory() as s:
        appointment = (await s.scalars(select(Appointment))).one()
    assert appointment.prospect_id == pid and appointment.calendar_event_id.endswith("-slot-1")
    assert appointment.meeting_url == "https://zoom.example/slot-1"  # F-19


async def test_booking_failure_hands_off_instead_of_confirming(client, env):
    pid, mid, cid = await lead(client, "Rendez-vous svp")
    env.llm.qualification = Qualification(intent="meeting_request")
    await run(client, cid)
    await say(client, cid, "Le premier")
    env.llm.qualification = Qualification(intent="slot_choice", chosen_slot=1)
    env.calendar.fail_booking = True
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] == "reservation_impossible"
    assert "C'est noté" not in (out["reply"] or "")  # aucune fausse confirmation


async def test_unrecognised_slot_choice_proposes_again(client, env):
    pid, mid, cid = await lead(client, "Rendez-vous svp")
    env.llm.qualification = Qualification(intent="meeting_request")
    await run(client, cid)
    await say(client, cid, "Plutôt jeudi")
    env.llm.qualification = Qualification(intent="slot_choice", chosen_slot=None)
    out = (await run(client, cid)).json()
    assert out["action"] == "propose_meeting" and env.calendar.booked == []


@pytest.mark.parametrize(
    ("calendar", "reason"),
    [
        (UnconfiguredCalendar(), "agenda_indisponible"),
        (FakeCalendar(slots=[]), "aucun_creneau"),
    ],
)
async def test_missing_calendar_never_invents_availability(client, env, calendar, reason):
    pid, mid, cid = await lead(client, "Je veux un rendez-vous")
    env.calendar = calendar
    app.dependency_overrides[get_calendar] = lambda: calendar
    env.llm.qualification = Qualification(intent="meeting_request")
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] == reason
    assert (await conversation(client, cid))["status"] == "handed_off"


# --- Scénario 3 : question inconnue -> information absente -> transfert au conseiller ---


async def test_unknown_question_is_handed_to_an_advisor_with_a_complete_sheet(
    client, env, session_factory
):
    question = "Quel est le coût exact de la formation et peut-elle être financée par mon CPF ?"
    pid, mid, cid = await lead(client, question)
    await say(client, cid, "Merci d'avance", role="agent")  # historique : un échange précédent
    await say(client, cid, question)
    env.llm.qualification = Qualification(intent="question")
    out = (await run(client, cid)).json()
    assert out["action"] == "continue_conversation"
    assert out["handoff_reason"] == "question_hors_base"

    conv = await conversation(client, cid)
    assert conv["status"] == "handed_off"
    sheet = conv["handoff"]  # F-21 : fiche de transfert complète
    assert sheet["reason"] == "question_hors_base"
    assert sheet["pending_question"] == question
    assert sheet["identity"]["first_name"] == "Jean" and sheet["identity"]["email"]
    assert sheet["campaign"] == "Recrutement eBIHAR" and sheet["source"] == "LinkedIn"
    assert sheet["channel"] == "email" and sheet["history"] and sheet["summary"]
    assert {"interest", "fit", "total", "level"} <= set(sheet["score"])
    assert sheet["qualification"]["intent"] == "question" and sheet["recommended_action"]
    assert (
        conv["messages"][-1]["role"] == "agent"
        and conv["messages"][-1]["metadata"]["mode"] == "handoff"
    )

    async with session_factory() as s:  # F-20 : le transfert est tracé
        traced = (
            await s.scalars(select(Interaction).where(Interaction.type == "human_handoff"))
        ).all()
    assert len(traced) == 1 and traced[0].intent == "question_hors_base"
    # Aucune réponse factuelle n'a été rédigée : seul le résumé a sollicité le modèle.
    assert all("Extraits de la base" not in s for s, _ in env.llm.generate_calls)
    # L'agent n'intervient plus sur une conversation reprise par un humain.
    assert (await run(client, cid)).status_code == 409


async def test_question_is_answered_from_the_validated_knowledge_base(client, env):
    pid, mid, cid = await lead(client, "Combien de temps dure le programme ?")
    env.kb.passages = [Passage(source="faq-ebihar", text="Le programme eBIHAR dure 18 mois.")]
    env.llm.qualification = Qualification(intent="question")
    env.llm.reply = "Le programme eBIHAR dure 18 mois."
    out = (await run(client, cid)).json()
    assert out["reply"] == "Le programme eBIHAR dure 18 mois." and out["handoff_reason"] is None
    reply_system = env.llm.generate_calls[-1][0]
    assert "[faq-ebihar] Le programme eBIHAR dure 18 mois." in reply_system  # RAG : source citée
    assert (await conversation(client, cid))["messages"][-1]["metadata"]["sources"] == [
        "faq-ebihar"
    ]


# --- NF-10 : jamais d'information inventée ---


async def test_invented_figures_are_rejected_and_handed_off(client, env):
    pid, mid, cid = await lead(client, "Bonjour, des infos ?")
    env.llm.reply = "La formation coûte 4500 euros et dure 18 mois."
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] == "reponse_non_verifiable"
    assert (
        len(env.llm.generate_calls) >= 2 and "ATTENTION" in env.llm.generate_calls[1][0]
    )  # 1 essai strict
    texts = [m["content"] for m in (await conversation(client, cid))["messages"]]
    assert not any("4500" in t for t in texts)  # rien d'inventé n'a été enregistré


async def test_a_corrected_second_attempt_is_accepted(client, env):
    pid, mid, cid = await lead(client, "Bonjour, des infos ?")
    replies = iter(
        ["Cela coûte 3000 euros.", "Je vous en dis plus avec plaisir, quel est votre projet ?"]
    )
    env.llm.reply = lambda system, messages: next(replies)
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] is None and "3000" not in out["reply"]


# --- Scénario 4 : opt-out -> aucune nouvelle communication commerciale ---


async def test_opt_out_is_detected_without_the_model_and_stops_everything(
    client, env, session_factory
):
    pid, mid, cid = await lead(client, "STOP, ne m'écrivez plus.")
    async with session_factory() as s:
        s.add(
            FollowUp(
                prospect_id=pid,
                campaign_prospect_id=mid,
                scheduled_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
            )
        )
        await s.commit()
    out = (await run(client, cid)).json()
    assert out["action"] == "opt_out" and out["reply"] is None
    assert env.llm.extract_calls == [] and env.llm.generate_calls == []  # sans appel au modèle

    async with session_factory() as s:
        prospect = await s.get(Prospect, pid)
        events = (await s.scalars(select(ConsentEvent))).all()
        follow_ups = (await s.scalars(select(FollowUp))).all()
    assert prospect.consent_status.value == "opted_out" and prospect.opted_out_at is not None
    assert [e.event_type.value for e in events] == ["withdrawn"]
    assert all(f.status is FollowUpStatus.CANCELLED for f in follow_ups)  # relances annulées
    conv = await conversation(client, cid)
    assert conv["status"] == "closed"
    assert all(m["role"] == "prospect" for m in conv["messages"])  # aucune réponse envoyée
    assert (await membership(client, mid))["conversion_stage"] == "lost"
    assert (await run(client, cid)).status_code == 409
    blocked = await client.post(
        f"{API}/conversations/{cid}/messages", json={"role": "agent", "content": "x"}
    )
    assert blocked.status_code == 409


async def test_already_unsubscribed_prospect_is_never_contacted(client, env):
    pid, mid, cid = await lead(client, None)
    await client.post(f"{API}/prospects/{pid}/opt-out", json={})
    await say(client, cid, "Bonjour")
    out = (await run(client, cid)).json()
    assert out["action"] == "close" and out["reply"] is None
    assert env.llm.generate_calls == []


# --- Scénario 5 : API indisponible -> reprise ou transfert humain ---


@pytest.mark.parametrize(
    "failure", [LLMUnavailableError("quota dépassé"), LLMConfigError("GEMINI_API_KEY absent")]
)
async def test_model_failure_hands_off_with_a_deterministic_summary(client, env, failure):
    question = "Pouvez-vous m'expliquer le programme ?"
    pid, mid, cid = await lead(client, question)
    env.llm = FakeLLM(qualification=failure, reply=failure)
    app.dependency_overrides[get_language_model] = lambda: env.llm
    out = (await run(client, cid)).json()
    assert out["action"] == "human_handoff" and out["handoff_reason"] == "llm_indisponible"
    conv = await conversation(client, cid)
    assert conv["status"] == "handed_off"
    assert question in conv["handoff"]["summary"]  # résumé sans modèle
    assert any("modèle indisponible" in t["summary"] for t in out["trace"])
    assert out["reply"] and out["llm"]["provider"] == "fake"


async def test_reply_generation_failure_after_qualification_hands_off(client, env):
    pid, mid, cid = await lead(client, "Bonjour")
    env.llm.reply = LLMUnavailableError("503")
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] == "llm_indisponible"


# --- Autres cas de transfert (F-20) ---


@pytest.mark.parametrize(
    ("text", "qualification", "reason"),
    [
        (
            "Je vais porter plainte contre votre école.",
            Qualification(intent="other"),
            "situation_sensible",
        ),
        (
            "Je veux parler à un conseiller.",
            Qualification(intent="needs_advisor"),
            "demande_conseiller",
        ),
        ("Hmm... peut-être ?", Qualification(intent="question", confidence=0.2), "incertitude"),
        (
            "Je négocie les frais ?",
            Qualification(intent="other", needs_human=True),
            "demande_conseiller",
        ),
    ],
)
async def test_handoff_cases(client, env, text, qualification, reason):
    pid, mid, cid = await lead(client, text)
    env.llm.qualification = qualification
    out = (await run(client, cid)).json()
    assert out["action"] == "human_handoff" and out["handoff_reason"] == reason
    assert (await conversation(client, cid))["handoff"]["recommended_action"]


async def test_not_interested_closes_without_follow_up(client, env, session_factory):
    pid, mid, cid = await lead(client, "Non merci, cela ne m'intéresse pas.")
    env.llm.qualification = Qualification(intent="not_interested", sentiment="negative")
    out = (await run(client, cid)).json()
    assert out["action"] == "close" and out["reply"] is None
    assert (await conversation(client, cid))["status"] == "closed"
    assert (await membership(client, mid))["conversion_stage"] == "lost"
    async with session_factory() as s:
        assert (await s.scalars(select(FollowUp))).all() == []


# --- Qualification progressive (F-09) et minimisation des données (S-01) ---


async def test_profile_is_enriched_and_known_data_is_never_asked_again(
    client, env, session_factory
):
    pid, mid, cid = await lead(client, "Je suis en Bac+3 d'informatique.")
    env.llm.qualification = Qualification(
        intent="interested", study_level="Bac+3", field_of_study="informatique"
    )
    first = (await run(client, cid)).json()
    async with session_factory() as s:
        profile = (await s.get(Prospect, pid)).profile
    assert profile["study_level"] == "Bac+3" and profile["field_of_study"] == "informatique"
    system = env.llm.generate_calls[-1][0]
    assert "son niveau d'études" not in system  # déjà connu : jamais redemandé
    assert "ce qu'il ou elle recherche" in system  # reste à qualifier : UNE seule question
    assert "Pose au maximum UNE question" in system
    assert any(
        "profil enrichi" in t["summary"] and "study_level" in t["summary"] for t in first["trace"]
    )

    await say(client, cid, "Je veux devenir data analyst.", role="prospect")
    env.llm.qualification = Qualification(intent="interested", goal="devenir data analyst")
    second = (await run(client, cid)).json()
    assert "Ne pose pas de question de qualification" in env.llm.generate_calls[-1][0]
    reasons = {e["reason"] for e in (await history(client, mid))["score_events"]}
    assert (
        "Informations de qualification complètes" in reasons
    )  # profil complet : points d'adéquation
    assert second["scores"]["fit"] == 10


async def test_prompts_never_contain_contact_details(client, env):
    pid, mid, cid = await lead(client, "Bonjour, je suis intéressé par le programme.")
    env.llm.qualification = Qualification(intent="interested", sentiment="positive")
    await run(client, cid)
    prompts = env.llm.all_prompts
    assert "Jean" in prompts  # le prénom personnalise l'échange
    for private in ("jean.dupont@example.com", "0612345678", "linkedin"):
        assert (
            private not in prompts
        )  # minimisation : pas d'email ni de téléphone envoyés au modèle


# --- Premier contact ---


async def test_first_contact_writes_an_introduction(client, env):
    pid, mid, cid = await lead(client, None)
    out = (await run(client, cid)).json()
    assert out["trigger"] == "first_contact" and out["action"] == "continue_conversation"
    assert out["reply"] == INTRO
    assert "premier message" in env.llm.generate_calls[0][0].lower()
    assert env.llm.extract_calls == []  # rien à qualifier
    assert out["stage_after"] == "contacted"
    assert (await conversation(client, cid))["messages"][-1]["role"] == "agent"
    assert (await history(client, mid))["score_events"] == []  # aucun signal d'engagement


async def test_run_can_target_a_prospect_and_opens_the_conversation(client, env):
    pid, mid, cid = await lead(client, None)
    out = await client.post(f"{API}/agent/runs", json={"prospect_id": pid})
    assert out.status_code == 201 and out.json()["conversation_id"] == cid  # reprend l'active


# --- Traçabilité (NF-04, OB-05) ---


async def test_every_run_is_explained_and_retrievable(client, env):
    pid, mid, cid = await lead(client, "Bonjour, des informations svp ?")
    env.llm.qualification = Qualification(intent="interested", sentiment="positive")
    out = (await run(client, cid)).json()
    nodes = [t["node"] for t in out["trace"]]
    assert nodes[:6] == [
        "load_prospect", "identify_context", "enrich_prospect",
        "qualify_prospect", "calculate_score", "decide_next_action",
    ]  # fmt: skip
    assert nodes[-1] == "finalize" and all(t["summary"] and t["at"] for t in out["trace"])
    decision = next(t for t in out["trace"] if t["node"] == "decide_next_action")
    assert out["action"] in decision["summary"] and out["reason"] in decision["summary"]
    score = next(t for t in out["trace"] if t["node"] == "calculate_score")
    assert "Sentiment positif exprimé" in score["summary"]  # chaque variation est justifiée
    assert out["stage_before"] == "new" and out["stage_after"] == "in_conversation"
    assert out["scores"]["total"] > 0 and out["llm"] == {"provider": "fake", "model": "fake-1"}

    fetched = (await client.get(f"{API}/agent/runs/{out['run_id']}")).json()
    # MongoDB tronque les horodatages à la milliseconde : on compare le contenu.
    assert [(t["node"], t["summary"]) for t in fetched["trace"]] == [
        (t["node"], t["summary"]) for t in out["trace"]
    ]
    assert fetched["reason"] == out["reason"]
    listed = (await client.get(f"{API}/prospects/{pid}/agent-runs")).json()
    assert [r["run_id"] for r in listed] == [out["run_id"]]
    assert (await client.get(f"{API}/agent/runs/not-an-id")).status_code == 404
    assert (await client.get(f"{API}/agent/runs/{'0' * 24}")).status_code == 404
    assert (await client.get(f"{API}/prospects/999/agent-runs")).status_code == 404


async def test_stage_changes_made_by_the_agent_are_attributed_to_the_system(client, env):
    pid, mid, cid = await lead(client, "Bonjour, je suis intéressé.")
    env.llm.qualification = Qualification(intent="interested")
    await run(client, cid)
    events = (await history(client, mid))["stage_events"]
    assert events and events[-1]["actor_user_id"] is None  # décision automatique
    assert events[-1]["reason"]


# --- Garde-fous de l'API ---


async def test_conflicts_and_not_found(client, env):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    assert (await run(client, cid)).status_code == 409  # dernier message = celui de l'agent
    assert (await run(client, "0" * 24)).status_code == 404
    assert (await run(client, "invalide")).status_code == 404
    assert (await client.post(f"{API}/agent/runs", json={"prospect_id": 999})).status_code == 404
    assert (await client.post(f"{API}/agent/runs", json={})).status_code == 422


async def test_roles(client, env, make_client):
    pid, mid, cid = await lead(client, "Bonjour")
    viewer = await make_client(UserRole.VIEWER)
    anon = await make_client(None)
    assert (await run(viewer, cid)).status_code == 403
    assert (await run(anon, cid)).status_code == 401
    advisor = await make_client(UserRole.ADVISOR)
    out = await run(advisor, cid)
    assert out.status_code == 201
    assert (await viewer.get(f"{API}/agent/runs/{out.json()['run_id']}")).status_code == 200


async def test_without_any_model_configured_the_agent_degrades_to_a_human(client, make_client):
    """Aucune clé : le workflow n'échoue pas, il transfère (et l'opt-out marche quand même)."""
    from app.config import Settings
    from app.integrations.llm.factory import create_language_model

    pid, mid, cid = await lead(client, "Je voudrais des informations.")
    null = create_language_model(Settings(_env_file=None))
    app.dependency_overrides[get_language_model] = lambda: null
    app.dependency_overrides[get_calendar] = lambda: FakeCalendar()
    app.dependency_overrides[get_knowledge_base] = lambda: FakeKnowledge()
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] == "llm_indisponible"


# --- Architecture : le coeur du graphe ne dépend d'aucun SDK (NF-01, NF-02) ---

FORBIDDEN = {
    "sqlalchemy", "motor", "pymongo", "httpx", "requests", "redis", "openai",
    "google", "langchain_google_genai", "langchain_openai", "fastapi",
}  # fmt: skip


def test_graph_package_imports_no_platform_sdk():
    root = pathlib.Path(__file__).resolve().parents[1] / "app" / "graph"
    offenders = []
    for path in root.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for name in names:
                top = name.split(".")[0]
                if top in FORBIDDEN or name.startswith(
                    ("app.services", "app.integrations", "app.agents", "app.database")
                ):
                    offenders.append(f"{path.name}: {name}")
    assert offenders == []


def test_workflow_has_the_nodes_of_the_specification():
    deps = Deps(
        llm=FakeLLM(),
        gateway=None,
        messenger=None,
        calendar=FakeCalendar(),
        knowledge=FakeKnowledge(),
    )  # type: ignore[arg-type]
    nodes = set(build_workflow(deps).get_graph().nodes)
    cdc = {
        "load_prospect", "identify_context", "enrich_prospect", "qualify_prospect",
        "calculate_score", "decide_next_action", "generate_response", "send_message",
        "schedule_followup", "propose_meeting", "get_calendar_slots", "book_meeting",
        "human_handoff", "close_conversation",
    }  # fmt: skip
    assert cdc <= nodes


def test_messenger_marks_messages_as_not_delivered_yet():
    assert RecordingMessenger  # la livraison réelle (email, Meta) viendra avec les connecteurs


# --- Les relances ne partent jamais vers quelqu'un qui est déjà en échange (F-16) ---


async def scheduled(session_factory):
    async with session_factory() as s:
        return [f.status.value for f in await s.scalars(select(FollowUp))]


async def test_a_reply_from_the_prospect_cancels_the_pending_follow_up(
    client, env, session_factory
):
    pid, mid, cid = await lead(client, "Bonjour, je regardais votre site.")
    env.llm.qualification = Qualification(intent="other")
    await run(client, cid)
    assert await scheduled(session_factory) == ["scheduled"]  # relance de précaution programmée
    await say(client, cid, "En fait j'ai une question.")  # il répond
    assert await scheduled(session_factory) == ["cancelled"]


async def test_an_agent_message_does_not_cancel_follow_ups(client, env, session_factory):
    pid, mid, cid = await lead(client, "Bonjour, je regardais votre site.")
    env.llm.qualification = Qualification(intent="other")
    await run(client, cid)
    await say(client, cid, "Message d'un conseiller", role="advisor")
    assert await scheduled(session_factory) == ["scheduled"]


async def test_an_inbound_interaction_cancels_but_an_outbound_one_does_not(
    client, env, session_factory
):
    pid, mid, cid = await lead(client, "Bonjour, je regardais votre site.")
    env.llm.qualification = Qualification(intent="other")
    await run(client, cid)
    body = {"type": "email", "direction": "outbound", "channel": "email", "content": "x"}
    await client.post(f"{API}/prospects/{pid}/interactions", json=body)
    assert await scheduled(session_factory) == ["scheduled"]
    await client.post(f"{API}/prospects/{pid}/interactions", json={**body, "direction": "inbound"})
    assert await scheduled(session_factory) == ["cancelled"]


async def test_a_handoff_to_a_human_cancels_follow_ups(client, env, session_factory):
    from datetime import UTC, datetime

    pid, mid, cid = await lead(client, "Je vais porter plainte.")
    async with session_factory() as s:
        s.add(FollowUp(prospect_id=pid, campaign_prospect_id=mid, scheduled_at=datetime.now(UTC)))
        await s.commit()
    env.llm.qualification = Qualification(intent="other")
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] == "situation_sensible"
    assert await scheduled(session_factory) == ["cancelled"]  # un humain a repris


@pytest.mark.parametrize("status", ["closed", "handed_off"])
async def test_manually_closing_or_handing_off_a_conversation_cancels_follow_ups(
    client, env, session_factory, status
):
    from datetime import UTC, datetime

    pid, mid, cid = await lead(client, None)
    async with session_factory() as s:
        s.add(FollowUp(prospect_id=pid, campaign_prospect_id=mid, scheduled_at=datetime.now(UTC)))
        await s.commit()
    assert (
        await client.patch(f"{API}/conversations/{cid}", json={"summary": "x"})
    ).status_code == 200
    assert await scheduled(session_factory) == ["scheduled"]  # un simple résumé ne change rien
    await client.patch(f"{API}/conversations/{cid}", json={"status": status})
    assert await scheduled(session_factory) == ["cancelled"]


# --- Questions sur le catalogue : réponse, pas de transfert ---


async def test_a_catalogue_question_is_answered_while_a_specific_question_is_not(client, env):
    pid, mid, cid = await lead(client, "Quelles formations proposez-vous ?")
    env.llm.qualification = Qualification(intent="question", asks_catalogue=True)
    env.llm.reply = "Nous proposons eBIHAR, Les Compagnons et le Master eBIHAR."
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] is None and "Compagnons" in out["reply"]
    assert "Programmes de DATUM Academy (liste validée)" in env.llm.generate_calls[-1][0]

    await say(client, cid, "Et quel est le prix du Master ?")
    env.llm.qualification = Qualification(intent="question")  # précis : pas du catalogue
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] == "question_hors_base"
