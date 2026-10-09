import asyncio

import pytest
from app.config import Settings
from app.graph.ports import ChatMessage, LLMConfigError, LLMError, LLMUnavailableError
from app.graph.state import Qualification
from app.integrations.llm.factory import NullLanguageModel, create_language_model
from app.integrations.llm.langchain_adapter import LangChainLanguageModel, _text
from app.integrations.llm.resilient import ResilientLanguageModel, classify
from langchain_core.messages import AIMessage
from pydantic import BaseModel

MSGS = [ChatMessage(role="user", content="Bonjour")]


class HttpError(Exception):
    def __init__(self, status_code: int, message: str = "") -> None:
        super().__init__(message or f"HTTP {status_code}")
        self.status_code = status_code


class Scripted:
    """Modèle qui échoue selon un scénario puis réussit."""

    provider, model = "scripted", "s-1"

    def __init__(self, failures: list[Exception], result: str = "ok") -> None:
        self.failures = list(failures)
        self.result = result
        self.calls = 0

    async def generate(self, system, messages):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return self.result

    async def extract(self, system, messages, schema):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return schema(intent="other")


def resilient(inner, retries=3, **kw):
    delays: list[float] = []

    async def fake_sleep(d):
        delays.append(d)

    model = ResilientLanguageModel(inner, max_retries=retries, sleep=fake_sleep, **kw)
    return model, delays


# --- Classement des erreurs ---


@pytest.mark.parametrize(
    ("exc", "kind"),
    [
        (HttpError(429), "transient"),
        (HttpError(503), "transient"),
        (Exception("RESOURCE_EXHAUSTED: quota exceeded"), "transient"),
        (TimeoutError(), "transient"),
        (ConnectionError("reset"), "transient"),
        (Exception("503 UNAVAILABLE the model is overloaded"), "transient"),
        (HttpError(401), "auth"),
        (HttpError(403), "auth"),
        (Exception("API key not valid. Please pass a valid API key."), "auth"),
        (HttpError(400, "invalid argument"), "fatal"),
        (ValueError("bug"), "fatal"),
    ],
)
def test_error_classification(exc, kind):
    assert classify(exc) == kind


# --- Nouveaux essais avec attente progressive (NF-05, scénario 5) ---


async def test_retries_transient_errors_then_succeeds_with_exponential_backoff():
    inner = Scripted([HttpError(429), HttpError(503)])
    model, delays = resilient(inner, base_delay=1.0)
    assert await model.generate("sys", MSGS) == "ok"
    assert inner.calls == 3
    assert delays == [1.0, 2.0]  # attente croissante


async def test_backoff_is_capped():
    model, delays = resilient(Scripted([HttpError(429)] * 6), retries=5, base_delay=4, max_delay=10)
    with pytest.raises(LLMUnavailableError):
        await model.generate("sys", MSGS)
    assert delays == [4, 8, 10, 10, 10]


async def test_gives_up_after_max_retries_with_unavailable_error():
    inner = Scripted([HttpError(503)] * 10)
    model, delays = resilient(inner, retries=2)
    with pytest.raises(LLMUnavailableError, match="indisponible"):
        await model.generate("sys", MSGS)
    assert inner.calls == 3 and len(delays) == 2


async def test_auth_and_invalid_requests_are_not_retried():
    inner = Scripted([HttpError(403)])
    model, delays = resilient(inner)
    with pytest.raises(LLMConfigError, match="clé invalide"):
        await model.generate("sys", MSGS)
    assert inner.calls == 1 and delays == []

    inner = Scripted([HttpError(400, "bad request")])
    model, _ = resilient(inner)
    with pytest.raises(LLMError) as err:
        await model.generate("sys", MSGS)
    assert not isinstance(err.value, LLMUnavailableError) and inner.calls == 1


async def test_config_errors_pass_through_untouched():
    model, _ = resilient(Scripted([LLMConfigError("clé absente")]))
    with pytest.raises(LLMConfigError, match="clé absente"):
        await model.generate("sys", MSGS)


async def test_timeout_is_retried():
    class Slow:
        provider, model = "slow", "m"
        calls = 0

        async def generate(self, system, messages):
            self.calls += 1
            await asyncio.sleep(1)
            return "trop tard"

        async def extract(self, system, messages, schema):
            raise NotImplementedError

    slow = Slow()
    model, delays = resilient(slow, retries=1, timeout=0.01)
    with pytest.raises(LLMUnavailableError):
        await model.generate("sys", MSGS)
    assert slow.calls == 2 and len(delays) == 1


async def test_extract_is_also_resilient_and_exposes_provider():
    inner = Scripted([HttpError(429)])
    model, _ = resilient(inner)
    result = await model.extract("sys", MSGS, Qualification)
    assert result.intent == "other" and inner.calls == 2
    assert (model.provider, model.model) == ("scripted", "s-1")


# --- Adaptateur LangChain ---


def test_text_extraction_handles_string_and_block_content():
    assert _text(AIMessage(content="Bonjour")) == "Bonjour"
    blocks = AIMessage(content=[{"type": "text", "text": "Bon"}, {"type": "text", "text": "jour"}])
    assert _text(blocks) == "Bonjour"


class _StubChat:
    def __init__(self, response):
        self.response = response
        self.seen = None

    async def ainvoke(self, messages):
        self.seen = messages
        return self.response

    def with_structured_output(self, schema):
        outer = self

        class _Runnable:
            async def ainvoke(self, messages):
                outer.seen = messages
                return outer.response

        return _Runnable()


async def test_langchain_adapter_converts_messages_and_returns_text():
    chat = _StubChat(AIMessage(content="  Réponse  "))
    llm = LangChainLanguageModel(chat, provider="gemini", model="m")
    history = [
        ChatMessage(role="user", content="Salut"),
        ChatMessage(role="assistant", content="Hello"),
    ]
    assert await llm.generate("SYSTEME", history) == "Réponse"
    kinds = [type(m).__name__ for m in chat.seen]
    assert kinds == ["SystemMessage", "HumanMessage", "AIMessage"]
    assert chat.seen[0].content == "SYSTEME"


async def test_langchain_adapter_rejects_empty_text():
    llm = LangChainLanguageModel(_StubChat(AIMessage(content="  ")), provider="gemini", model="m")
    with pytest.raises(LLMError, match="vide"):
        await llm.generate("s", MSGS)


async def test_langchain_adapter_structured_output():
    expected = Qualification(intent="question", goal="devenir data analyst")
    llm = LangChainLanguageModel(_StubChat(expected), provider="gemini", model="m")
    assert await llm.extract("s", MSGS, Qualification) == expected
    as_dict = LangChainLanguageModel(_StubChat({"intent": "other"}), provider="x", model="m")
    assert (await as_dict.extract("s", MSGS, Qualification)).intent == "other"
    broken = LangChainLanguageModel(_StubChat(None), provider="x", model="m")
    with pytest.raises(LLMError, match="structurée"):
        await broken.extract("s", MSGS, Qualification)


# --- Fabrique : changer de fournisseur par configuration ---


def settings(**kw):
    return Settings(_env_file=None, **kw)


async def test_factory_without_key_returns_a_null_model_that_fails_cleanly():
    llm = create_language_model(settings(llm_provider="gemini"))
    assert isinstance(llm, NullLanguageModel) and llm.provider == "gemini"
    with pytest.raises(LLMConfigError, match="GEMINI_API_KEY"):
        await llm.generate("s", MSGS)
    with pytest.raises(LLMConfigError):
        await llm.extract("s", MSGS, Qualification)


def test_factory_unknown_provider_is_reported():
    llm = create_language_model(settings(llm_provider="skynet"))
    assert isinstance(llm, NullLanguageModel)
    assert "skynet" in llm._reason and "gemini" in llm._reason


def test_factory_builds_gemini_with_key_and_wraps_it_with_retries():
    llm = create_language_model(
        settings(llm_provider="gemini", gemini_api_key="fake-key-for-tests", llm_model="gemini-x")
    )
    assert isinstance(llm, ResilientLanguageModel)
    assert (llm.provider, llm.model) == ("gemini", "gemini-x")


def test_switching_provider_is_a_configuration_change():
    """OpenAI : clé absente -> erreur de configuration claire ; aucun code à modifier."""
    llm = create_language_model(settings(llm_provider="openai"))
    assert isinstance(llm, NullLanguageModel) and llm.provider == "openai"
    assert "OPENAI_API_KEY" in llm._reason


def test_provider_name_is_case_insensitive():
    assert create_language_model(settings(llm_provider="GEMINI")).provider == "gemini"


def test_structured_schema_is_a_plain_pydantic_model():
    assert issubclass(Qualification, BaseModel)
    assert Qualification.model_json_schema()["properties"]["intent"]["enum"]
