import os
from collections.abc import AsyncIterator

import app.models  # noqa: F401
import pytest
from app.database.base import Base
from app.database.session import get_session
from app.main import app
from app.models import Channel, Target
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool


@pytest.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Base de test : SQLite en mémoire par défaut, PostgreSQL si TEST_DATABASE_URL est défini
    (la CI utilise PostgreSQL)."""
    url = os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite://")
    kwargs = {"poolclass": StaticPool} if url.startswith("sqlite") else {}
    engine = create_async_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine.sync_engine, "connect")
        def _fk_on(dbapi_conn, _):
            dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        s.add_all(
            [
                Channel(name="email", type="email"),
                Channel(name="facebook", type="social"),
                Target(code="ebihar_students", name="Étudiants eBIHAR"),
            ]
        )
        await s.commit()
    yield factory
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def client(session_factory) -> AsyncIterator[AsyncClient]:
    async def _override() -> AsyncIterator[AsyncSession]:
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_session] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
