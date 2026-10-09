"""Adaptateur générique : tout modèle de chat LangChain devient un `LanguageModel`.

Gemini, OpenAI, Anthropic, Hugging Face... exposent tous la même interface LangChain
(`BaseChatModel`) : ajouter un fournisseur = une ligne dans factory.py.
"""

from collections.abc import Sequence
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.graph.ports import ChatMessage, LLMError, T


def _to_langchain(system: str, messages: Sequence[ChatMessage]) -> list[BaseMessage]:
    converted: list[BaseMessage] = [SystemMessage(content=system)]
    for m in messages:
        converted.append(
            HumanMessage(content=m.content) if m.role == "user" else AIMessage(content=m.content)
        )
    return converted


def _text(message: Any) -> str:
    """Texte d'une réponse, que le fournisseur renvoie une chaîne ou une liste de blocs."""
    text = getattr(message, "text", None)
    if isinstance(text, str):
        return text
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    return "".join(part if isinstance(part, str) else str(part.get("text", "")) for part in content)


class LangChainLanguageModel:
    def __init__(self, chat_model: BaseChatModel, *, provider: str, model: str) -> None:
        self._chat = chat_model
        self._provider = provider
        self._model = model

    @property
    def provider(self) -> str:
        return self._provider

    @property
    def model(self) -> str:
        return self._model

    async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
        response = await self._chat.ainvoke(_to_langchain(system, messages))
        text = _text(response).strip()
        if not text:
            raise LLMError(f"{self._provider} a renvoyé une réponse vide")
        return text

    async def extract(self, system: str, messages: Sequence[ChatMessage], schema: type[T]) -> T:
        structured = self._chat.with_structured_output(schema)
        result = await structured.ainvoke(_to_langchain(system, messages))
        if isinstance(result, schema):
            return result
        if isinstance(result, dict):
            return schema.model_validate(result)
        raise LLMError(f"{self._provider} n'a pas renvoyé de sortie structurée exploitable")
