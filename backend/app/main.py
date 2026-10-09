import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.router import api_router
from app.config import get_settings
from app.core.logging import configure_logging
from app.database.clients import close_clients, get_mongo_db
from app.database.session import dispose_engine
from app.services.conversations import ensure_indexes

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        await ensure_indexes(get_mongo_db())
    except Exception:  # MongoDB pas encore prêt : l'API démarre, /health/ready signalera l'état
        logger.exception("Création des index MongoDB impossible au démarrage")
    yield
    await dispose_engine()
    await close_clients()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title=settings.app_name, version="0.1.0", debug=settings.debug, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
