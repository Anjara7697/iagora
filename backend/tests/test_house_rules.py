"""Consignes maison (D-53) : API réservée aux administrateurs, versions, contrôle par le code."""

from app.graph import policy, prompts
from app.graph.ports import HouseRules
from app.models.enums import UserRole
from app.services import house_rules

API = "/api/v1/settings/house-rules"


async def test_house_rules_are_empty_until_an_admin_writes_them(client):
    r = await client.get(API)
    assert r.status_code == 200
    assert r.json() | {"updated_at": None} == {
        "style": "",
        "banned": [],
        "version": 0,
        "updated_by": None,
        "updated_at": None,
    }


async def test_each_save_is_a_new_version_kept_in_history(client):
    await client.put(API, json={"style": "Ton chaleureux", "banned": ["  Cher  ami ", "cher ami"]})
    second = (await client.put(API, json={"style": "Ton sobre", "banned": []})).json()
    assert second["version"] == 2 and second["style"] == "Ton sobre"
    history = (await client.get(f"{API}/history")).json()
    assert [v["version"] for v in history] == [2, 1]
    assert history[1]["banned"] == ["Cher ami"]  # espaces resserrés, doublon retiré
    assert history[1]["updated_by"] is not None


async def test_only_the_last_versions_are_kept(client, mongo_db):
    for i in range(house_rules.KEEP_VERSIONS + 3):
        await house_rules.save(mongo_db, f"v{i}", [], None)
    history = await house_rules.history(mongo_db)
    assert len(history) == house_rules.KEEP_VERSIONS
    assert history[0].rules.version == house_rules.KEEP_VERSIONS + 3


async def test_house_rules_are_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(API)).status_code == 403
    assert (await advisor.put(API, json={"style": "Tutoie"})).status_code == 403


async def test_house_rules_are_bounded(client):
    assert (await client.put(API, json={"style": "x" * 2001})).status_code == 422
    assert (await client.put(API, json={"banned": ["a"] * 31})).status_code == 422
    assert (await client.put(API, json={"banned": ["x"]})).status_code == 422
    assert (await client.put(API, json={"banned": ["x" * 81]})).status_code == 422


def test_banned_phrases_ignore_case_accents_and_apostrophes_but_match_whole_words():
    banned = ["N'hésitez pas", "cher", "à très vite"]
    assert policy.banned_phrases("n’HESITEZ   pas à revenir", banned) == ["N'hésitez pas"]
    assert policy.banned_phrases("Vous pouvez chercher un financement.", banned) == []
    assert policy.banned_phrases("Cher Jean, à tres vite !", banned) == ["cher", "à très vite"]


def test_the_house_rules_block_is_subordinate_to_the_absolute_rules():
    assert prompts.house_rules_block(None) == ""
    assert prompts.house_rules_block(HouseRules()) == ""
    block = prompts.house_rules_block(HouseRules(style="1. Phrases courtes\n\n• Sobre", version=3))
    assert "Les règles absolues ci-dessus priment toujours" in block
    assert "ce qu'elles affirment n'est pas une source" in block
    assert block.endswith("- Phrases courtes\n- Sobre")
