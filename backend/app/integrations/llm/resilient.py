"""Nouveaux essais avec attente progressive autour de n'importe quel modèle (NF-05, §10.3).

429 (quota), 5xx, délai dépassé et sorties invalides : nouvel essai avec attente croissante.
Clé refusée ou requête invalide : inutile de réessayer, on signale tout de suite.
Quand les essais sont épuisés, `LLMUnavailableError` : le workflow transfère au conseiller.
"""

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable, Sequence
from typing import TypeVar

from app.graph.ports import (
    ChatMessage,
    LanguageModel,
    LLMConfigError,
    LLMError,
    LLMUnavailableError,
    T,
)

logger = logging.getLogger(__name__)
R = TypeVar("R")

_AUTH = re.compile(
    r"\b(401|403)\b|api key|api_key|permission denied|unauthenticated|invalid.*key", re.I
)
_TRANSIENT = re.compile(
    r"\b(429|500|502|503|504)\b|resource.?exhausted|rate.?limit|quota|unavailable|overloaded"
    r"|timed? ?out|timeout|connection|temporar|try again|deadline",
    re.I,
)


def classify(exc: BaseException) -> str:
    """'transient' (on réessaie), 'auth' (clé refusée), ou 'fatal'."""
    if isinstance(exc, LLMConfigError):
        return "auth"
    if isinstance(exc, TimeoutError | asyncio.TimeoutError | ConnectionError):
        return "transient"
    name = type(exc).__name__
    if "OutputParser" in name or "ValidationError" in name:
        return "transient"  # sortie structurée invalide : un nouvel essai suffit souvent
    text = f"{name} {exc}"
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(code, int):
        text += f" {code}"
    if _AUTH.search(text):
        return "auth"
    if _TRANSIENT.search(text):
        return "transient"
    return "fatal"


class ResilientLanguageModel:
    def __init__(
        self,
        inner: LanguageModel,
        *,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 20.0,
        timeout: float = 30.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._inner = inner
        self._max_retries = max_retries
        self._base_delay = base_delay
        self._max_delay = max_delay
        self._timeout = timeout
        self._sleep = sleep

    @property
    def provider(self) -> str:
        return self._inner.provider

    @property
    def model(self) -> str:
        return self._inner.model

    async def _call(self, operation: str, fn: Callable[[], Awaitable[R]]) -> R:
        delay = self._base_delay
        for attempt in range(self._max_retries + 1):
            try:
                return await asyncio.wait_for(fn(), timeout=self._timeout)
            except LLMError as exc:
                if isinstance(exc, LLMConfigError):
                    raise
                kind = "transient"
                error: BaseException = exc
            except Exception as exc:
                kind = classify(exc)
                error = exc
            if kind == "auth":
                raise LLMConfigError(
                    f"{self.provider} a refusé la requête (clé invalide ou droits insuffisants)"
                ) from error
            if kind == "fatal":
                raise LLMError(f"{self.provider} : {type(error).__name__}: {error}") from error
            if attempt == self._max_retries:
                logger.error(
                    "%s indisponible après %d essais : %s", self.provider, attempt + 1, error
                )
                raise LLMUnavailableError(
                    f"{self.provider} indisponible après {attempt + 1} essai(s) ({operation})"
                ) from error
            logger.warning(
                "%s : %s, nouvel essai dans %.1f s (%d/%d)",
                self.provider, type(error).__name__, delay, attempt + 1, self._max_retries,
            )  # fmt: skip
            await self._sleep(delay)
            delay = min(delay * 2, self._max_delay)
        raise AssertionError("inatteignable")  # pragma: no cover

    async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
        return await self._call("generate", lambda: self._inner.generate(system, messages))

    async def extract(self, system: str, messages: Sequence[ChatMessage], schema: type[T]) -> T:
        return await self._call("extract", lambda: self._inner.extract(system, messages, schema))
