from fastapi import APIRouter, Response, status

from app.services.health import check_dependencies

router = APIRouter(tags=["health"])


@router.get("/health")
async def liveness() -> dict[str, str]:
    """Le processus repond."""
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness(response: Response) -> dict[str, object]:
    """Les bases de donnees sont joignables."""
    deps = await check_dependencies()
    ok = all(deps.values())
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ok" if ok else "degraded", "dependencies": deps}
