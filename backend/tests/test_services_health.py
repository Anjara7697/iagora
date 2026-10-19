from app.services import health


async def test_check_dependencies_reports_failures(monkeypatch):
    async def ok():
        return None

    async def ko():
        raise RuntimeError("down")

    monkeypatch.setattr(health, "_ping_postgres", ok)
    monkeypatch.setattr(health, "_ping_mongo", ko)
    monkeypatch.setattr(health, "_ping_redis", ok)
    assert await health.check_dependencies() == {"postgres": True, "mongo": False, "redis": True}


async def test_redis_is_skipped_when_not_configured(monkeypatch):
    async def ok():
        return None

    async def boom():
        raise AssertionError("Redis ne doit pas être contacté sans REDIS_URL")

    monkeypatch.setattr(health, "_ping_postgres", ok)
    monkeypatch.setattr(health, "_ping_mongo", ok)
    monkeypatch.setattr(health, "_ping_redis", boom)
    without_redis = health.get_settings().model_copy(update={"redis_url": ""})
    monkeypatch.setattr(health, "get_settings", lambda: without_redis)
    assert await health.check_dependencies() == {"postgres": True, "mongo": True}
