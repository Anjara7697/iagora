"""Page Évaluation : lancer, suivre, annuler, importer et comparer des passages (recette).

Pendant un passage, les tests attendent la tâche de fond sans appeler l'API : en local, la base
SQLite de test n'a qu'une connexion, que la vérification de session partagerait avec le passage."""

import asyncio

import pytest
from app.api.dependencies import get_embeddings, get_language_model
from app.config import get_settings
from app.devtools import eval_runs, kb_evaluation
from app.graph.ports import Passage
from app.integrations.llm.factory import NullLanguageModel
from app.main import app
from app.models import Prospect
from app.models.enums import UserRole
from sqlalchemy import func, select

API = "/api/v1/evaluations"


@pytest.fixture(autouse=True)
def no_real_services(client):
    """Aucun vrai modèle ni embeddings : seuls les passages hors ligne peuvent tourner."""
    app.dependency_overrides[get_language_model] = lambda: NullLanguageModel(
        "gemini", "absent", "clé absente"
    )
    app.dependency_overrides[get_embeddings] = lambda: None


async def wait_until_finished(client, run_id):
    active = eval_runs._ACTIVE
    assert active is not None and active.run_id == run_id
    await asyncio.wait_for(asyncio.shield(active.task), timeout=60)
    return (await client.get(f"{API}/{run_id}")).json()


async def wait_for_first_result(run_id):
    active = eval_runs._ACTIVE
    assert active is not None and active.run_id == run_id
    async with asyncio.timeout(30):
        while active.done < 1:
            await asyncio.sleep(0.05)


async def launch(client, **settings):
    response = await client.post(API, json={"label": "essai", **settings})
    assert response.status_code == 202, response.text
    return response.json()


async def test_only_admins_outside_production(client, make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(API)).status_code == 403
    assert (await advisor.post(API, json={"suite": "agent", "label": "x"})).status_code == 403
    production = get_settings().model_copy(update={"environment": "production"})
    app.dependency_overrides[get_settings] = lambda: production
    assert (await client.get(f"{API}/catalog")).status_code == 403


async def test_the_catalog_lists_suites_and_what_can_be_used(client):
    catalog = (await client.get(f"{API}/catalog")).json()
    suites = {s["key"]: s for s in catalog["suites"]}
    assert set(suites) == {"agent", "conversations", "simulation", "kb"}
    personas = {p["id"]: p for p in suites["simulation"]["items"]}
    assert len(personas) == 6 and personas["sceptique_robot"]["turns"] >= 2
    conv = {c["id"]: c for c in suites["conversations"]["items"]}
    assert conv["parcours_rdv_ebihar"]["turns"] >= 2 and "live_only" in conv["parcours_rdv_ebihar"]
    assert "sans-rag" in suites["agent"]["ablations"] and suites["agent"]["categories"]
    assert catalog["model"] == {"available": False, "name": None}
    assert catalog["embeddings"]["available"] is False
    assert catalog["llm_calls_per_turn"] == 2 and catalog["running"] is None
    assert catalog["simulation_calls_per_turn"] == 3  # un appel de plus : le prospect simulé


async def test_a_conversation_run_is_measured_like_the_command_line(client, session_factory):
    run = await launch(client, suite="conversations", ids=["parcours_rdv_ebihar"])
    assert run["status"] == "running" and run["model"] == "faux modèle scripté"
    done = await wait_until_finished(client, run["id"])
    assert done["status"] == "done", done.get("error")
    indicators = {i["key"]: i for i in done["indicators"]}
    assert indicators["conform"]["value"] == 1.0
    assert indicators["conform"]["display"] == "1/1 (100 %)"
    assert indicators["advisor_offers"]["better"] == "down"
    (conv,) = done["report"]["conversations"]
    assert conv["title"] and conv["issues"] == []
    roles = [m["role"] for m in conv["transcript"]]
    assert roles[0] == "prospect" and "agent" in roles  # l'échange complet, pour la page
    assert done["settings"]["live"] is False and done["cleaned_up"] >= 1
    async with session_factory() as session:  # prospects fictifs supprimés à la fin
        assert await session.scalar(select(func.count()).select_from(Prospect)) == 0
    listed = (await client.get(API)).json()
    assert listed[0]["id"] == run["id"] and "report" not in listed[0]


async def test_a_simulation_run_plays_every_pass_of_every_persona(client, session_factory):
    run = await launch(client, suite="simulation", ids=["hors_sujet", "sceptique_robot"], passes=2)
    assert run["status"] == "running" and run["model"] == "faux modèle scripté"
    done = await wait_until_finished(client, run["id"])
    assert done["status"] == "done", done.get("error")
    assert done["settings"]["passes"] == 2 and done["suite_label"] == "Prospects simulés"
    assert done["progress"]["total"] == 4 and done["progress"]["done"] == 4
    ids = [c["id"] for c in done["report"]["conversations"]]
    assert ids == ["hors_sujet#1", "hors_sujet#2", "sceptique_robot#1", "sceptique_robot#2"]
    assert done["report"]["meta"]["suite"] == "simulation"
    indicators = {i["key"]: i for i in done["indicators"]}  # les mêmes que les conversations
    assert "/4 (" in indicators["conform"]["display"]  # quatre conversations mesurées
    async with session_factory() as session:  # prospects fictifs supprimés à la fin
        assert await session.scalar(select(func.count()).select_from(Prospect)) == 0


async def test_a_simulation_report_from_the_command_line_is_imported_as_a_simulation(client):
    report = {
        "meta": {"suite": "simulation", "model": "gemini/x", "mode": "réel (gemini/x)"},
        "summary": {"conform": {"ok": 5, "total": 6, "rate": 0.83}},
        "conversations": [{"id": "hors_sujet#1", "title": "Hors sujet", "ok": True, "turns": []}],
    }
    response = await client.post(f"{API}/import", json={"label": "sim", "report": report})
    assert response.status_code == 201, response.text
    assert response.json()["suite"] == "simulation"
    by_key = {i["key"]: i for i in response.json()["indicators"]}
    assert by_key["conform"]["display"] == "5/6 (83 %)"


async def test_the_number_of_passes_is_bounded(client):
    response = await client.post(API, json={"suite": "simulation", "label": "x", "passes": 6})
    assert response.status_code == 422


async def test_agent_settings_are_applied_and_kept_with_the_run(client):
    catalog = (await client.get(f"{API}/catalog")).json()
    agent = next(s for s in catalog["suites"] if s["key"] == "agent")
    category = agent["categories"][0]
    run = await launch(
        client, suite="agent", categories=[category], ablation="sans-rag", min_score=0.5
    )
    done = await wait_until_finished(client, run["id"])
    assert done["status"] == "done", done.get("error")
    assert done["settings"]["categories"] == [category]
    assert done["settings"]["ablation"] == "sans-rag" and "min_score" not in done["settings"]
    cases = done["report"]["cases"]
    assert cases and all(c["category"] == category for c in cases)
    assert all("message" in c and "gaps" in c for c in cases)
    assert done["report"]["meta"]["ablation"] == "sans-rag"


async def test_one_run_at_a_time_and_a_cancelled_run_keeps_its_results(client):
    run = await launch(client, suite="agent", pause=30)
    await wait_for_first_result(run["id"])  # puis 30 s de pause : le passage attend
    second = await client.post(API, json={"suite": "kb", "label": "autre"})
    assert second.status_code == 409
    assert (await client.get(f"{API}/{run['id']}")).json()["progress"]["done"] == 1
    assert (await client.delete(f"{API}/{run['id']}")).status_code == 409  # en cours
    cancelled = (await client.post(f"{API}/{run['id']}/cancel")).json()
    assert cancelled["status"] == "cancelled"
    assert len(cancelled["report"]["cases"]) == cancelled["progress"]["done"] == 1
    assert (await client.post(f"{API}/{run['id']}/cancel")).status_code == 409


async def test_invalid_settings_are_refused_before_anything_runs(client):
    unknown = await client.post(API, json={"suite": "agent", "label": "x", "ids": ["inexistant"]})
    assert unknown.status_code == 422 and "inexistant" in unknown.json()["detail"]
    live = await client.post(API, json={"suite": "conversations", "label": "x", "live": True})
    assert live.status_code == 422 and "vrai modèle" in live.json()["detail"]
    kb = await client.post(API, json={"suite": "kb", "label": "x"})
    assert kb.status_code == 422 and "Embeddings" in kb.json()["detail"]
    assert (await client.get(API)).json() == []


async def test_command_line_reports_are_imported_and_completed(client):
    """Un rapport plus ancien (sans titre ni échange) : l'échange est reconstitué à partir des
    conversations écrites et des réponses enregistrées."""
    old = {
        "meta": {"mode": "réel (gemini/x)", "model": "gemini/x", "knowledge": "lexicale"},
        "summary": {"conform": {"ok": 7, "total": 8, "rate": 0.875}, "reasked": 2},
        "conversations": [
            {"id": "parcours_rdv_ebihar", "ok": True, "turns": [{"id": "t1", "reply": "Bonjour !"}]}
        ],
    }
    response = await client.post(
        f"{API}/import",
        json={"label": "conv-avant", "ran_at": "2026-11-10T10:00:00Z", "report": old},
    )
    assert response.status_code == 201, response.text
    imported = response.json()
    assert imported["suite"] == "conversations" and imported["source"] == "import"
    by_key = {i["key"]: i for i in imported["indicators"]}
    assert by_key["conform"]["display"] == "7/8 (88 %)" and by_key["reasked"]["value"] == 2
    assert by_key["meeting"]["display"] == "n/a"  # indicateur plus récent que le rapport
    detail = (await client.get(f"{API}/{imported['id']}")).json()
    (conv,) = detail["report"]["conversations"]
    assert conv["title"] and conv["transcript"][0]["role"] == "prospect"
    assert conv["transcript"][1] == {"role": "agent", "text": "Bonjour !"}
    bad = await client.post(f"{API}/import", json={"label": "x", "report": {"foo": 1}})
    assert bad.status_code == 422


async def test_a_run_can_be_renamed_dated_and_deleted(client):
    report = {"summary": {"conform": {"ok": 1, "total": 1}}, "cases": []}
    run = (await client.post(f"{API}/import", json={"label": "a", "report": report})).json()
    changed = await client.patch(
        f"{API}/{run['id']}", json={"label": "après #234", "ran_at": "2026-11-17T09:00:00Z"}
    )
    assert changed.json()["label"] == "après #234"
    assert (await client.delete(f"{API}/{run['id']}")).status_code == 204
    assert (await client.get(f"{API}/{run['id']}")).status_code == 404


def test_indicators_are_the_same_for_every_report_version():
    values = eval_runs.indicators("agent", {"conform": {"ok": 3, "total": 4}, "errors": 0})
    by_key = {i["key"]: i for i in values}
    assert by_key["conform"]["value"] == 0.75 and by_key["errors"]["display"] == "0"
    assert by_key["latency"]["value"] is None and by_key["latency"]["display"] == "n/a"


class _Kb:
    min_score = 0.6

    def __init__(self, answers):
        self.answers = answers

    async def search_all(self, question, target, k):
        found = self.answers.get(question)
        return [Passage(source=f"{found[0]} / partie", text="…", score=found[1])] if found else []


async def test_the_knowledge_evaluation_reports_what_was_found():
    cases = [
        kb_evaluation.KbCase("Durée ?", "ebihar_students", "ebihar"),
        kb_evaluation.KbCase("Météo ?", "ebihar_students", None),
        kb_evaluation.KbCase("Salaire ?", "ebihar_students", None, same_topic=True),
    ]
    kb = _Kb({"Durée ?": ("eBIHAR", 0.8), "Météo ?": ("eBIHAR", 0.3), "Salaire ?": ("eBIHAR", 0.7)})
    results = await kb_evaluation.run(kb, {"eBIHAR": "ebihar"}, cases)
    assert [r.ok for r in results] == [True, True, None]
    summary = kb_evaluation.summarize(results, kb.min_score)
    assert summary["conform"] == {"ok": 2, "total": 2, "rate": 1.0}
    assert summary["same_topic_retained"] == 1 and summary["off_topic_score_max"] == 0.3
    payload = kb_evaluation.to_payload(results, summary, model="m")
    assert payload["questions"][0]["found"] == "ebihar"
    assert eval_runs._detect_suite(payload) == "kb"
