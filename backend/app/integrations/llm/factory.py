"""Choix du fournisseur de modèle de langage par configuration (LLM_PROVIDER).

Changer de fournisseur ne touche ni le workflow ni les agents :
    LLM_PROVIDER=gemini  LLM_MODEL=gemini-2.5-flash  GEMINI_API_KEY=...
    LLM_PROVIDER=openai  LLM_MODEL=<modèle>  OPENAI_API_KEY=...  (pip install langchain-openai)
Pour un nouveau fournisseur : ajouter une fonction `_build_xxx` et l'inscrire dans `_BUILDERS`.
"""

from collections.abc import Callable, Sequence
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel

from app.config import Settings
from app.graph.ports import ChatMessage, LanguageModel, LLMConfigError, T
from app.integrations.llm.langchain_adapter import LangChainLanguageModel
from app.integrations.llm.resilient import ResilientLanguageModel


class NullLanguageModel:
    """Modèle absent : toute requête échoue proprement et le workflow transfère à un humain."""

    def __init__(self, provider: str, model: str, reason: str) -> None:
        self._provider = provider
        self._model = model
        self._reason = reason

    @property
    def provider(self) -> str:
        return self._provider

    @property
    def model(self) -> str:
        return self._model

    async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
        raise LLMConfigError(self._reason)

    async def extract(self, system: str, messages: Sequence[ChatMessage], schema: type[T]) -> T:
        raise LLMConfigError(self._reason)


def _secret(value: Any) -> str:
    return value.get_secret_value() if value is not None else ""


def _build_gemini(settings: Settings) -> BaseChatModel:
    key = _secret(settings.gemini_api_key)
    if not key:
        raise LLMConfigError("GEMINI_API_KEY n'est pas défini")
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=settings.llm_model,
        google_api_key=key,
        temperature=settings.llm_temperature,
        max_retries=0,  # les nouveaux essais sont gérés par ResilientLanguageModel
    )


def _build_openai(settings: Settings) -> BaseChatModel:
    key = _secret(settings.openai_api_key)
    if not key:
        raise LLMConfigError("OPENAI_API_KEY n'est pas défini")
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:
        raise LLMConfigError("Installer le paquet : pip install langchain-openai") from exc
    chat: BaseChatModel = ChatOpenAI(
        model=settings.llm_model,
        api_key=key,
        temperature=settings.llm_temperature,
        max_retries=0,
    )
    return chat


_BUILDERS: dict[str, Callable[[Settings], BaseChatModel]] = {
    "gemini": _build_gemini,
    "openai": _build_openai,
}


def create_language_model(settings: Settings) -> LanguageModel:
    provider = settings.llm_provider.lower()
    builder = _BUILDERS.get(provider)
    if builder is None:
        return NullLanguageModel(
            provider,
            settings.llm_model,
            f"Fournisseur inconnu : {provider!r} ({sorted(_BUILDERS)})",
        )
    try:
        chat = builder(settings)
    except LLMConfigError as exc:
        return NullLanguageModel(provider, settings.llm_model, str(exc))
    return ResilientLanguageModel(
        LangChainLanguageModel(chat, provider=provider, model=settings.llm_model),
        max_retries=settings.llm_max_retries,
        timeout=settings.llm_timeout_seconds,
    )
