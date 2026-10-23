"""Paramètres de la console : IA (modèle de secours compris), relances, disponibilités."""

from zoneinfo import ZoneInfo

import pytest
from app.api.v1 import settings as settings_api
from app.config import Settings, get_settings
from app.graph.ports import ChatMessage, LLMConfigError, LLMUnavailableError
from app.integrations.llm.factory import create_language_model
from app.integrations.llm.fallback import FallbackLanguageModel
from app.main import app
from app.models.enums import UserRole
from app.services import calendar_config, runtime_settings
from app.services.agenda import ConsoleCalendar

API = "/api/v1"


def base(**over) -> Settings:
    return Settings(_env_file=None, **over)


FORM = {
    "llm_provider": "gemini",
    "llm_model": "gemini-2.5-flash",
    "llm_fallback_model": "gemini-2.5-flash-lite",
    "llm_temperature": 0.2,
    "agent_auto_reply": False,
    "follow_up_window_start_hour": 9,
    "follow_up_window_end_hour": 18,
    "follow_up_weekdays_only": True,
    "follow_up_max_per_silence": 2,
    "email_footer": "Répondez STOP pour ne plus être contacté.",
    "email_create_unknown_senders": True,
    "email_poll_seconds": 30,
    "calendar_timezone": "Europe/Paris",
    "calendar_work_days": "1,2,3,4,5",
    "calendar_work_start_hour": 14,
    "calendar_work_end_hour": 15,
    "calendar_slot_minutes": 30,
    "calendar_min_notice_hours": 0,
    "calendar_horizon_days": 14,
    "calendar_buffer_minutes": 0,
    "gemini_api_key": "AIza-console-key",
}


# --- Modèle de secours --------------------------------------------------------------------------


class Model:
    def __init__(self, name, error=None):
        self.provider, self.model, self.error, self.calls = "gemini", name, error, 0

    async def generate(self, system, messages):
        self.calls += 1
        if self.error:
            raise self.error
        return f"réponse de {self.model}"

    async def extract(self, system, messages, schema):
        return await self.generate(system, messages)


async def test_fallback_model_answers_when_the_main_one_is_saturated():
    primary = Model("principal", LLMUnavailableError("503"))
    secondary = Model("secours")
    llm = FallbackLanguageModel(primary, secondary)
    msg = [ChatMessage(role="user", content="x")]
    assert await llm.generate("s", msg) == "réponse de secours"
    assert await llm.extract("s", msg, dict) == "réponse de secours"
    assert llm.model == "principal" and llm.fallback_model == "secours"


async def test_fallback_is_not_used_for_a_refused_key():
    llm = FallbackLanguageModel(Model("p", LLMConfigError("clé")), Model("s"))
    with pytest.raises(LLMConfigError):
        await llm.generate("s", [ChatMessage(role="user", content="x")])


def test_factory_adds_the_fallback_only_when_useful():
    with_key = {"gemini_api_key": "k"}
    assert isinstance(
        create_language_model(base(llm_fallback_model="gemini-2.5-flash-lite", **with_key)),
        FallbackLanguageModel,
    )
    assert not isinstance(create_language_model(base(**with_key)), FallbackLanguageModel)
    same = base(llm_model="m", llm_fallback_model="m", **with_key)
    assert not isinstance(create_language_model(same), FallbackLanguageModel)


# --- Stockage et application -------------------------------------------------------------------


def test_console_values_override_env_and_keys_are_encrypted():
    s = base(llm_model="env-model")
    doc = runtime_settings.to_document(s, dict(FORM), None, 1)
    assert "AIza-console-key" not in str(doc)
    eff = runtime_settings.apply(s, doc)
    assert eff.llm_model == "gemini-2.5-flash" and eff.llm_fallback_model == "gemini-2.5-flash-lite"
    assert eff.gemini_api_key.get_secret_value() == "AIza-console-key"
    assert eff.agent_auto_reply is False and eff.calendar_work_start_hour == 14
    kept = runtime_settings.to_document(s, {**FORM, "gemini_api_key": None}, doc, 1)
    assert kept["secrets"]["gemini_api_key"] == doc["secrets"]["gemini_api_key"]


async def test_unreachable_database_falls_back_to_env():
    class Broken:
        def __getitem__(self, name):
            raise RuntimeError("mongo down")

    s = base(llm_model="env-model")
    assert (await runtime_settings.effective(Broken(), s)) is s


async def test_appointment_hours_come_from_the_console(mongo_db):
    s = base()
    await calendar_config.save(mongo_db, s, {"provider": "demo"}, 1)
    await runtime_settings.save(mongo_db, s, dict(FORM), 1)
    slots = await ConsoleCalendar(s, lambda: mongo_db).get_available_slots(3)
    assert slots and all(sl.start.astimezone(ZoneInfo("Europe/Paris")).hour == 14 for sl in slots)


# --- API ----------------------------------------------------------------------------------------


@pytest.fixture
def env():
    app.dependency_overrides[get_settings] = lambda: base(llm_model="env-model")
    yield
    app.dependency_overrides.pop(get_settings, None)


async def test_settings_api_round_trip_without_secrets(client, env):
    first = (await client.get(f"{API}/settings")).json()
    assert first["source"] == "env" and first["llm_model"] == "env-model"
    assert first["gemini_api_key_set"] is False
    assert (await client.put(f"{API}/settings", json=FORM)).status_code == 204
    r = await client.get(f"{API}/settings")
    assert "AIza-console-key" not in r.text
    data = r.json()
    assert data["source"] == "console" and data["gemini_api_key_set"] is True
    assert data["llm_fallback_model"] == "gemini-2.5-flash-lite"
    assert (await client.delete(f"{API}/settings")).status_code == 204
    assert (await client.get(f"{API}/settings")).json()["source"] == "env"


async def test_effective_settings_reach_the_agent_dependencies(client, env, mongo_db):
    from app.api.dependencies import get_language_model, get_runtime_settings

    await client.put(f"{API}/settings", json=FORM)
    eff = await get_runtime_settings(base(llm_model="env-model"), mongo_db)
    llm = get_language_model(eff)
    assert isinstance(llm, FallbackLanguageModel) and llm.model == "gemini-2.5-flash"


@pytest.mark.parametrize(
    "change",
    [
        {"follow_up_window_start_hour": 19, "follow_up_window_end_hour": 8},
        {"calendar_work_start_hour": 18, "calendar_work_end_hour": 9},
        {"calendar_timezone": "Mars/Olympus"},
        {"calendar_work_days": "1,9"},
    ],
)
async def test_incoherent_values_are_refused(client, env, change):
    assert (await client.put(f"{API}/settings", json={**FORM, **change})).status_code == 422


async def test_llm_test_uses_typed_values(client, env, monkeypatch):
    seen = {}

    def fake_create(settings):
        seen["model"] = settings.llm_model
        seen["key"] = settings.gemini_api_key.get_secret_value()
        return Model(settings.llm_model)

    monkeypatch.setattr(settings_api, "create_language_model", fake_create)
    r = await client.post(f"{API}/settings/llm/test", json=FORM)
    assert r.json() == {
        "ok": True,
        "model": "gemini-2.5-flash",
        "detail": "réponse de gemini-2.5-flash",
    }
    assert seen == {"model": "gemini-2.5-flash", "key": "AIza-console-key"}
    assert (await client.get(f"{API}/settings")).json()["source"] == "env"  # rien d'enregistré

    monkeypatch.setattr(
        settings_api, "create_language_model", lambda s: Model("x", LLMUnavailableError("503"))
    )
    failed = (await client.post(f"{API}/settings/llm/test", json=FORM)).json()
    assert failed["ok"] is False and "503" in failed["detail"]


async def test_settings_are_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/settings")).status_code == 403
    assert (await advisor.put(f"{API}/settings", json=FORM)).status_code == 403
