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
