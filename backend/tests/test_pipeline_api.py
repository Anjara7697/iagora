import pytest
from app.models.enums import UserRole

API = "/api/v1"


@pytest.fixture
async def membership(client):
    """Un prospect rattaché à une campagne ; retourne l'identifiant du rattachement."""
    camp = (
        await client.post(
            f"{API}/campaigns",
            json={"name": "eBIHAR", "sources": [{"name": "LI", "type": "ads", "platform": "li"}]},
        )
    ).json()
    r = await client.post(
        f"{API}/prospects",
        json={
            "email": "jean@example.com",
            "campaign_id": camp["id"],
            "source_id": camp["sources"][0]["id"],
        },
    )
    return r.json()["prospect"]["campaigns"][0]["id"]


def _url(mid, suffix=""):
    return f"{API}/campaign-prospects/{mid}{suffix}"


async def _score(client, mid, **body):
    return await client.post(_url(mid, "/scores"), json=body)


# --- Étapes (F-13) ---


async def test_stage_change_requires_reason_and_is_recorded(client, membership):
    assert (await client.get(_url(membership))).json()["conversion_stage"] == "new"
    no_reason = await client.patch(_url(membership), json={"conversion_stage": "contacted"})
    assert no_reason.status_code == 422
    blank = await client.patch(
        _url(membership), json={"conversion_stage": "contacted", "reason": "  "}
    )
    assert blank.status_code == 422

    r = await client.patch(
        _url(membership), json={"conversion_stage": "contacted", "reason": "Premier email envoyé"}
    )
    assert r.status_code == 200 and r.json()["conversion_stage"] == "contacted"
    stage = (await client.get(_url(membership, "/history"))).json()["stage_events"]
    assert len(stage) == 1
    assert stage[0]["from_stage"] == "new" and stage[0]["to_stage"] == "contacted"
    assert stage[0]["reason"] == "Premier email envoyé"
    assert stage[0]["actor_user_id"] is not None and stage[0]["created_at"]  # horodaté, auteur


async def test_same_stage_is_a_noop_and_closed_stages_can_reopen(client, membership):
    same = await client.patch(_url(membership), json={"conversion_stage": "new", "reason": "x"})
    assert same.status_code == 200
    assert (await client.get(_url(membership, "/history"))).json()["stage_events"] == []
    for stage in ("lost", "to_follow_up"):
        r = await client.patch(_url(membership), json={"conversion_stage": stage, "reason": "test"})
        assert r.status_code == 200
    events = (await client.get(_url(membership, "/history"))).json()["stage_events"]
    assert [(e["from_stage"], e["to_stage"]) for e in events] == [
        ("new", "lost"),
        ("lost", "to_follow_up"),
    ]


async def test_stage_filter_on_prospect_list(client, membership):
    await client.patch(_url(membership), json={"conversion_stage": "qualified", "reason": "ok"})
    listing = await client.get(f"{API}/prospects", params={"stage": "qualified"})
    assert listing.json()["total"] == 1
    assert (await client.get(f"{API}/prospects", params={"stage": "new"})).json()["total"] == 0


# --- Scoring (F-10, F-11, F-12) ---


async def test_signal_updates_scores_level_and_records_justified_events(client, membership):
    r = await _score(client, membership, signal="meeting_requested")
    assert r.status_code == 200
    m = r.json()["membership"]
    assert (m["interest_score"], m["fit_score"], m["total_score"]) == (30, 0, 18)
    assert m["interest_status"] == "cold"
    events = r.json()["events"]
    assert [(e["score_type"], e["points"], e["new_value"]) for e in events] == [
        ("interest", 30, 30),
        ("total", 18, 18),
    ]
    assert all(e["reason"] == "Demande de rendez-vous" for e in events)  # F-11

    m = (await _score(client, membership, signal="profile_target_match")).json()["membership"]
    assert (m["fit_score"], m["total_score"]) == (20, 26) and m["interest_status"] == "warm"

    # Le total passe de 26 à 62 : niveau chaud, motif enregistré (exemple du CdC §7.4).
    r = await _score(
        client, membership, score_type="interest", points=60, reason="A demandé un appel"
    )
    m = r.json()["membership"]
    assert (m["interest_score"], m["total_score"]) == (90, 62)
    assert m["interest_status"] == "hot"
    total = [e for e in r.json()["events"] if e["score_type"] == "total"][0]
    assert (total["points"], total["new_value"]) == (36, 62)

    history = (await client.get(_url(membership, "/history"))).json()["score_events"]
    assert len(history) == 6 and all(e["reason"] and e["actor_user_id"] for e in history)


async def test_scores_are_clamped_and_unchanged_scores_record_nothing(client, membership):
    up = await _score(client, membership, score_type="interest", points=100, reason="max")
    assert up.json()["membership"]["interest_score"] == 100
    again = await _score(client, membership, score_type="interest", points=50, reason="encore")
    assert again.json()["events"] == []  # déjà au plafond : aucune variation
    capped = await _score(client, membership, score_type="interest", points=-300, reason="x")
    assert capped.status_code == 422  # hors bornes de la requête
    down = await _score(client, membership, score_type="interest", points=-100, reason="reset")
    assert down.json()["membership"]["interest_score"] == 0
    below = await _score(client, membership, score_type="interest", points=-5, reason="plancher")
    assert below.json()["events"] == []
    assert (await client.get(_url(membership))).json()["interest_status"] == "cold"


async def test_manual_adjustment_validation(client, membership):
    assert (await _score(client, membership, score_type="interest", points=5)).status_code == 422
    blank = await _score(client, membership, score_type="interest", points=5, reason=" ")
    assert blank.status_code == 422
    total = await _score(client, membership, score_type="total", points=5, reason="x")
    assert total.status_code == 422  # le total est calculé
    both = await _score(
        client, membership, signal="message_received", score_type="fit", points=1, reason="x"
    )
    assert both.status_code == 422
    assert (await _score(client, membership)).status_code == 422
    assert (await _score(client, 999, signal="message_received")).status_code == 404


# --- Affectation (F-22) ---


async def test_assignment_is_admin_only_and_keeps_history(client, make_client, membership):
    advisor = await make_client(UserRole.ADVISOR)
    viewer = await make_client(UserRole.VIEWER)
    advisor_id = (await advisor.get(f"{API}/auth/me")).json()["id"]
    viewer_id = (await viewer.get(f"{API}/auth/me")).json()["id"]
    await _score(client, membership, signal="message_received")
    await client.patch(_url(membership), json={"conversion_stage": "contacted", "reason": "ok"})

    assert (
        await advisor.patch(_url(membership), json={"assigned_advisor_id": advisor_id})
    ).status_code == 403
    assigned = await client.patch(_url(membership), json={"assigned_advisor_id": advisor_id})
    assert assigned.json()["assigned_advisor_id"] == advisor_id
    assert (
        await client.patch(_url(membership), json={"assigned_advisor_id": viewer_id})
    ).status_code == 422  # un VIEWER n'est pas un conseiller
    assert (
        await client.patch(_url(membership), json={"assigned_advisor_id": 999})
    ).status_code == 422

    # Réaffectation puis retrait : scores, étapes et interactions restent intacts.
    admin_id = (await client.get(f"{API}/auth/me")).json()["id"]
    await client.patch(_url(membership), json={"assigned_advisor_id": admin_id})
    cleared = await client.patch(_url(membership), json={"assigned_advisor_id": None})
    assert cleared.json()["assigned_advisor_id"] is None
    history = (await client.get(_url(membership, "/history"))).json()
    assert len(history["stage_events"]) == 1 and len(history["score_events"]) == 2
    assert cleared.json()["interest_score"] == 5

    await client.patch(_url(membership), json={"assigned_advisor_id": advisor_id})
    mine = await client.get(f"{API}/prospects", params={"advisor_id": advisor_id})
    assert mine.json()["total"] == 1  # filtre par conseiller (F-23)


async def test_inactive_advisor_cannot_be_assigned(client, make_client, membership):
    advisor = await make_client(UserRole.ADVISOR)
    advisor_id = (await advisor.get(f"{API}/auth/me")).json()["id"]
    await client.patch(f"{API}/users/{advisor_id}", json={"is_active": False})
    r = await client.patch(_url(membership), json={"assigned_advisor_id": advisor_id})
    assert r.status_code == 422


# --- Droits ---


async def test_roles_on_pipeline_routes(client, make_client, membership):
    viewer = await make_client(UserRole.VIEWER)
    advisor = await make_client(UserRole.ADVISOR)
    anon = await make_client(None)
    assert (await viewer.get(_url(membership))).status_code == 200
    assert (await viewer.get(_url(membership, "/history"))).status_code == 200
    stage = {"conversion_stage": "contacted", "reason": "x"}
    assert (await viewer.patch(_url(membership), json=stage)).status_code == 403
    assert (await _score(viewer, membership, signal="message_received")).status_code == 403
    assert (await advisor.patch(_url(membership), json=stage)).status_code == 200
    assert (await _score(advisor, membership, signal="message_received")).status_code == 200
    assert (await anon.get(_url(membership))).status_code == 401
    assert (await client.get(_url(999))).status_code == 404
    assert (await client.get(_url(999, "/history"))).status_code == 404
    assert (await client.patch(_url(999), json={"assigned_advisor_id": None})).status_code == 404
