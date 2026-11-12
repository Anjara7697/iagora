"""Opposition détectée sur une formule ambiguë : enregistrée, puis vérifiée (AUDIT-BIZ-004)."""

import pytest
from app.graph import policy
from app.models.enums import UserRole

API = "/api/v1"
AMBIGUOUS = "Comment me désinscrire de mon école actuelle pour m'inscrire chez vous ?"


@pytest.mark.parametrize(
    ("text", "ambiguous"),
    [
        ("STOP", False),
        ("Stop merci", False),
        ("Désinscrivez-moi", False),
        (
            "Merci de ne plus me contacter, j'ai trouvé une autre école et ce n'est plus utile",
            False,
        ),
        (AMBIGUOUS, True),
        (
            "On peut faire du stop and go entre l'entreprise et les cours pendant la formation ?",
            True,
        ),
        ("Bonjour, des infos ?", False),  # pas une demande d'arrêt
    ],
)
def test_only_weak_formulas_in_a_long_message_or_a_question_are_ambiguous(text, ambiguous):
    assert policy.opt_out_is_ambiguous(text) is ambiguous


async def _message(client, text, external_id):
    prospect = await client.post(
        f"{API}/prospects", json={"email": "doute@example.com", "channel": "email"}
    )
    pid = prospect.json()["prospect"]["id"]
    r = await client.post(
        f"{API}/conversations",
        json={
            "prospect_id": pid,
            "channel": "email",
            "message": {"role": "prospect", "content": text, "external_message_id": external_id},
        },
    )
    return pid, r.json()["conversation"]["id"]


async def test_an_ambiguous_opt_out_is_recorded_then_shown_for_review(client):
    pid, cid = await _message(client, AMBIGUOUS, "doute-1")
    # Par prudence, l'opposition est enregistrée tout de suite.
    assert (await client.get(f"{API}/prospects/{pid}")).json()["consent_status"] == "opted_out"
    page = (await client.get(f"{API}/todo?kind=opt_out_check")).json()
    [item] = page["items"]
    assert item["id"] == f"optout:{cid}" and item["title"] == "Opposition à vérifier"
    assert "désinscrire de mon école" in item["detail"] and item["priority"] == "high"
    assert (await client.get(f"{API}/todo/item?id=optout:{cid}")).json()["kind"] == "opt_out_check"


async def test_a_clear_stop_is_not_sent_for_review(client):
    await _message(client, "STOP", "stop-clair")
    assert (await client.get(f"{API}/todo?kind=opt_out_check")).json()["items"] == []


async def test_an_advisor_confirms_but_only_an_admin_restores_consent(client, make_client):
    pid, cid = await _message(client, AMBIGUOUS, "doute-2")
    advisor = await make_client(UserRole.ADVISOR)
    refused = await advisor.post(
        f"{API}/conversations/{cid}/opt-out-review", json={"decision": "restore"}
    )
    assert refused.status_code == 403
    restored = await client.post(
        f"{API}/conversations/{cid}/opt-out-review", json={"decision": "restore"}
    )
    assert restored.json() == {"status": "restored"}
    assert (await client.get(f"{API}/prospects/{pid}")).json()["consent_status"] == "granted"
    assert (await client.get(f"{API}/todo?kind=opt_out_check")).json()["items"] == []
    again = await client.post(
        f"{API}/conversations/{cid}/opt-out-review", json={"decision": "confirm"}
    )
    assert again.status_code == 409  # une seule décision par signalement


async def test_confirming_keeps_the_opt_out(client, make_client):
    pid, cid = await _message(client, AMBIGUOUS, "doute-3")
    advisor = await make_client(UserRole.ADVISOR)
    r = await advisor.post(
        f"{API}/conversations/{cid}/opt-out-review", json={"decision": "confirm"}
    )
    assert r.json() == {"status": "confirmed"}
    assert (await client.get(f"{API}/prospects/{pid}")).json()["consent_status"] == "opted_out"
