from app import cli
from app.models import User
from app.models.enums import UserRole
from sqlalchemy import select


async def test_create_admin_command(session_factory, monkeypatch):
    monkeypatch.setattr(cli, "get_sessionmaker", lambda: session_factory)
    await cli._create_admin("root", "Root@Example.com", "a-long-password-1")
    async with session_factory() as s:
        user = (await s.scalars(select(User))).one()
    assert user.role == UserRole.ADMIN and user.email == "root@example.com"
    assert user.hashed_password.startswith("$argon2")


async def test_create_admin_rejects_weak_password_and_duplicates(session_factory, monkeypatch):
    import pytest

    monkeypatch.setattr(cli, "get_sessionmaker", lambda: session_factory)
    with pytest.raises(SystemExit):
        await cli._create_admin("root", "root@example.com", "short")
    await cli._create_admin("root", "root@example.com", "a-long-password-1")
    with pytest.raises(SystemExit):
        await cli._create_admin("root", "root@example.com", "a-long-password-1")
