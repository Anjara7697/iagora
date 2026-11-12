"""Téléphones au format international E.164 (AUDIT-DATA-001)."""

import pytest
from app.core import phones
from app.models import ErasureRecord
from app.services import erasure

API = "/api/v1"


@pytest.mark.parametrize(
    "raw",
    ["06 12 34 56 78", "06.12.34.56.78", "+33 6 12 34 56 78", "0033612345678", "+33612345678"],
)
def test_every_french_spelling_gives_the_same_number(raw):
    assert phones.normalize(raw, "FR") == "+33612345678"


def test_foreign_and_unusual_numbers_are_kept_never_refused():
    assert phones.normalize("+261 34 12 345 67", "FR") == "+261341234567"
    assert phones.normalize("12", "FR") == "12"  # trop court : gardé tel quel, nettoyé
    assert phones.normalize("  ", "FR") is None
    assert phones.normalize(None, "FR") is None


def test_legacy_forms_cover_how_numbers_were_stored_before():
    assert phones.legacy_forms("06 12 34 56 78", "FR") == [
        "+33612345678",
        "0612345678",
        "33612345678",
    ]


def test_plan_changes_numbers_but_never_merges_a_collision():
    changes, collisions = phones.plan(
        [(1, "0612345678"), (2, "+33612345678"), (3, "06 98 76 54 32"), (4, None), (5, "+33711")],
        "FR",
    )
    assert changes == {3: "+33698765432"}  # 1 et 2 désignent la même personne : non modifiés
    assert collisions == [[1, 2]]
    assert phones.plan([(3, "+33698765432")], "FR") == ({}, [])  # rejouable sans effet


async def test_national_and_international_spellings_are_the_same_prospect(client):
    first = await client.post(
        f"{API}/prospects",
        json={"first_name": "Inès", "phone": "06 01 02 03 04", "channel": "email"},
    )
    again = await client.post(
        f"{API}/prospects", json={"phone": "+33 6 01 02 03 04", "channel": "email"}
    )
    assert first.json()["prospect"]["phone"] == "+33601020304"
    assert again.json()["created"] is False
    assert again.json()["prospect"]["id"] == first.json()["prospect"]["id"]


async def test_an_opted_out_number_stays_opted_out_whatever_its_spelling(session_factory):
    """Une empreinte enregistrée avant E.164, sur `0612345678`, reconnaît `+33 6 12 34 56 78`."""
    async with session_factory() as s:
        s.add(
            ErasureRecord(
                former_prospect_id=1,
                reason="request",
                keep_suppressed=True,
                phone_hash=erasure.fingerprint("0612345678", phone=True),
            )
        )
        await s.commit()
        for spelling in ("+33 6 12 34 56 78", "06 12 34 56 78", "0033612345678"):
            assert await erasure.is_suppressed(s, email=None, phone=spelling)
        assert not await erasure.is_suppressed(s, email=None, phone="06 99 99 99 99")


async def test_an_erased_prospect_coming_back_in_another_format_is_still_suppressed(client):
    created = await client.post(
        f"{API}/prospects",
        json={"first_name": "Léa", "phone": "06 55 44 33 22", "channel": "email"},
    )
    pid = created.json()["prospect"]["id"]
    erased = await client.post(
        f"{API}/prospects/{pid}/erase", json={"reason": "request", "confirm": str(pid)}
    )
    assert erased.status_code == 200 and erased.json()["suppressed"] is True
    back = await client.post(f"{API}/prospects", json={"phone": "+33655443322", "channel": "email"})
    assert back.json()["prospect"]["consent_status"] == "opted_out"
