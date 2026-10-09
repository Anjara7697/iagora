"""Clients MongoDB (conversations) et Redis (cache/files d'attente)."""

from functools import lru_cache
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from redis.asyncio import Redis

from app.config import get_settings


@lru_cache
def get_mongo_client() -> "AsyncIOMotorClient[Any]":
    return AsyncIOMotorClient(get_settings().mongo_uri, serverSelectionTimeoutMS=2000)


def get_mongo_db() -> "AsyncIOMotorDatabase[Any]":
    return get_mongo_client()[get_settings().mongo_db]


@lru_cache
def get_redis() -> Redis:
    client: Redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
    return client


async def close_clients() -> None:
    if get_mongo_client.cache_info().currsize:
        get_mongo_client().close()
        get_mongo_client.cache_clear()
    if get_redis.cache_info().currsize:
        await get_redis().aclose()
        get_redis.cache_clear()
