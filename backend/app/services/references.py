"""Accès aux données de référence (canaux, cibles)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, Target
from app.services.errors import ValidationFailure


async def get_channel(session: AsyncSession, name: str | None) -> Channel | None:
    if name is None:
        return None
    channel = await session.scalar(select(Channel).where(Channel.name == name.strip().lower()))
    if channel is None:
        raise ValidationFailure(f"Canal inconnu : {name!r}")
    return channel


async def get_target(session: AsyncSession, code: str | None) -> Target | None:
    if code is None:
        return None
    target = await session.scalar(select(Target).where(Target.code == code))
    if target is None:
        raise ValidationFailure(f"Cible inconnue : {code!r}")
    return target
