"""Modèle de secours : si le modèle principal reste indisponible (503, quota) après ses nouveaux
essais, la même requête part sur un second modèle avant tout transfert au conseiller (NF-05)."""

import logging
from collections.abc import Sequence

from app.graph.ports import ChatMessage, LanguageModel, LLMUnavailableError, T

logger = logging.getLogger(__name__)


class FallbackLanguageModel:
    def __init__(self, primary: LanguageModel, secondary: LanguageModel) -> None:
        self._primary = primary
        self._secondary = secondary

    @property
    def provider(self) -> str:
        return self._primary.provider

    @property
    def model(self) -> str:
        return self._primary.model

    @property
    def fallback_model(self) -> str:
        return self._secondary.model

    async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
        try:
            return await self._primary.generate(system, messages)
        except LLMUnavailableError:
            logger.warning(
                "%s indisponible : modèle de secours %s", self.model, self.fallback_model
            )
            return await self._secondary.generate(system, messages)

    async def extract(self, system: str, messages: Sequence[ChatMessage], schema: type[T]) -> T:
        try:
            return await self._primary.extract(system, messages, schema)
        except LLMUnavailableError:
            logger.warning(
                "%s indisponible : modèle de secours %s", self.model, self.fallback_model
            )
            return await self._secondary.extract(system, messages, schema)
