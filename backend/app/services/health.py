"""Verification de l'etat des dependances (PostgreSQL, MongoDB, Redis)."""

from collections.abc import Awaitable, Callable

from sqlalchemy import text

from app.database.clients import get_mongo_client, get_redis
from app.database.session import get_engine


async def _ping_postgres() -> None:
    async with get_engine().connect() as conn:
        await conn.execute(text("SELECT 1"))


async def _ping_mongo() -> None:
    await get_mongo_client().admin.command("ping")


async def _ping_redis() -> None:
    await get_redis().ping()


async def check_dependencies() -> dict[str, bool]:
    checks: dict[str, Callable[[], Awaitable[None]]] = {
        "postgres": _ping_postgres,
        "mongo": _ping_mongo,
        "redis": _ping_redis,
    }
    result: dict[str, bool] = {}
    for name, ping in checks.items():
        try:
            await ping()
            result[name] = True
        except Exception:
            result[name] = False
    return result
