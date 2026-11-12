"""Boucles de fond par processus et verrous locaux libérés (AUDIT-ARCH-002)."""

import asyncio
import gc

from app.agents import runtime
from app.config import Settings
from app.main import background_workers


def _settings(**values: object) -> Settings:
    # Valeurs explicites : l'environnement de test désactive certaines boucles.
    defaults = {"agent_auto_reply": True, "follow_up_worker_enabled": True}
    return Settings(environment="development", **{**defaults, **values})  # type: ignore[arg-type]


def test_all_loops_run_in_the_single_process_by_default():
    assert background_workers(_settings()) == [
        "reply-queue",
        "follow-up-worker",
        "email-worker",
        "meta-resume",
    ]


def test_an_http_only_process_starts_no_loop():
    assert background_workers(_settings(background_workers_enabled=False)) == []


def test_each_loop_keeps_its_own_switch():
    names = background_workers(_settings(agent_auto_reply=False, follow_up_worker_enabled=False))
    assert names == ["email-worker", "meta-resume"]


async def test_conversation_lock_is_released_once_unused():
    lock = runtime._conversation_lock("c-lock")
    assert runtime._conversation_lock("c-lock") is lock  # même conversation : même verrou
    async with lock:
        await asyncio.sleep(0)
    del lock
    gc.collect()
    assert "c-lock" not in runtime._locks
