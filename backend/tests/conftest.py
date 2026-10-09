import os
from collections.abc import AsyncIterator
from typing import Any

import app.models  # noqa: F401
import pytest
from app.config import get_settings
from app.core.security import create_access_token, hash_password
from app.database.base import Base
from app.database.clients import get_mongo_db
from app.database.session import get_session
from app.main import app
from app.models import Channel, Target, User
from app.models.enums import UserRole
from app.services.conversations import ensure_indexes
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient
from motor.motor_asyncio import AsyncIOMotorClient
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
async def mongo_db() -> AsyncIterator[Any]:
    """MongoDB de test : `mongomock` par défaut, un vrai MongoDB si TEST_MONGO_URI est défini
    (la CI utilise MongoDB 7)."""
    uri = os.environ.get("TEST_MONGO_URI")
    if uri:
        client = AsyncIOMotorClient(uri, tz_aware=True, serverSelectionTimeoutMS=5000)
        await client.drop_database("iagora_test")
    else:
        client = AsyncMongoMockClient(tz_aware=True)
    db = client["iagora_test"]
    await ensure_indexes(db)
    yield db
    if uri:
        await client.drop_database("iagora_test")
        client.close()


PASSWORD = "correct-horse-battery"


async def _make_user(factory, role: UserRole, **over) -> User:
    async with factory() as s:
        user = User(
            username=f"{role.value.lower()}-user",
            email=f"{role.value.lower()}@example.com",
            hashed_password=hash_password(PASSWORD),
            role=role,
            **over,
        )
        s.add(user)
        await s.commit()
        return user


@pytest.fixture
async def make_client(session_factory, mongo_db):
    """Fabrique un client HTTP authentifié avec le rôle demandé (None : anonyme)."""
    clients: list[AsyncClient] = []

    async def _override() -> AsyncIterator[AsyncSession]:
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_session] = _override
    app.dependency_overrides[get_mongo_db] = lambda: mongo_db

    async def _make(role: UserRole | None = UserRole.ADMIN) -> AsyncClient:
        headers = {}
        if role is not None:
            user = await _make_user(session_factory, role)
            token = create_access_token(user.id, get_settings())
            headers["Authorization"] = f"Bearer {token}"
        c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)
        clients.append(c)
        return c

    yield _make
    for c in clients:
        await c.aclose()
    app.dependency_overrides.clear()


@pytest.fixture
async def client(make_client) -> AsyncClient:
    """Client authentifié ADMIN (la plupart des tests métier)."""
    return await make_client(UserRole.ADMIN)
