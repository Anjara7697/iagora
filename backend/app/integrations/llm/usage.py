"""Journal des appels au modèle pendant une exécution de l'agent (AUDIT-AI-004).

Pour chaque appel : modèle réellement utilisé (le modèle de secours apparaît sous son nom), type,
durée, réussite, et jetons quand le fournisseur les renvoie. Sert à relier une réponse à son modèle
et à suivre les quotas et le coût. Aucun contenu (ni consigne, ni message) n'est enregistré.
"""

import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

_CALLS: ContextVar[list[dict[str, Any]] | None] = ContextVar("llm_calls", default=None)


@contextmanager
def recording() -> Iterator[list[dict[str, Any]]]:
    """Collecte les appels faits dans ce bloc (y compris dans les tâches qu'il lance)."""
    calls: list[dict[str, Any]] = []
    token = _CALLS.set(calls)
    try:
        yield calls
    finally:
        _CALLS.reset(token)


def record(
    *,
    provider: str,
    model: str,
    kind: str,
    started: float,
    ok: bool,
    usage: Any = None,
) -> None:
    calls = _CALLS.get()
    if calls is None:
        return
    entry: dict[str, Any] = {
        "provider": provider,
        "model": model,
        "kind": kind,
        "ms": round((time.monotonic() - started) * 1000),
        "ok": ok,
    }
    if isinstance(usage, dict):
        for key in ("input_tokens", "output_tokens", "total_tokens"):
            if isinstance(usage.get(key), int):
                entry[key] = usage[key]
    calls.append(entry)
