import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents.auto import email_loop, follow_up_loop, meta_resume_loop, reply_queue_loop
from app.agents.runtime import ensure_run_indexes
from app.api.errors import register_error_handlers
from app.api.router import api_router
from app.config import Settings, get_settings
from app.core.http_guard import HttpGuard
from app.core.logging import configure_logging
from app.database.clients import close_clients, get_mongo_db
from app.database.session import dispose_engine
from app.services import service_tokens
from app.services.conversations import ensure_indexes

logger = logging.getLogger(__name__)


def require_explicit_environment(settings: Settings) -> None:
    """Refuse de démarrer le serveur sans ENVIRONMENT explicite (AUDIT-ARCH-004).

    Sans lui, l'API se croirait en « development » : documentation publique, documents fictifs dans
    le RAG, simulateur autorisé. Les outils en ligne de commande et les tests n'en dépendent pas."""
    if "environment" not in settings.model_fields_set:
        raise RuntimeError(
            "ENVIRONMENT absent : indiquez ENVIRONMENT=production (ou development pour une "
            "instance d'essai) dans le fichier .env avant de démarrer l'API."
        )


def background_workers(settings: Settings) -> list[str]:
    """Boucles de fond à lancer dans ce processus (AUDIT-ARCH-002)."""
    if not settings.background_workers_enabled:
        return []
    names: list[str] = []
    if settings.agent_auto_reply:
        names.append("reply-queue")
    if settings.follow_up_worker_enabled:
        names.append("follow-up-worker")
    # Toujours lancées hors tests : elles ne font rien tant que la boîte ou Meta ne sont pas
    # configurés et activés (console Intégrations ou `.env`), et suivent les changements sans
    # redémarrage.
    if settings.environment != "test":
        names += ["email-worker", "meta-resume"]
    return names


_LOOPS = {
    "reply-queue": reply_queue_loop,
    "follow-up-worker": follow_up_loop,
    "email-worker": email_loop,
    "meta-resume": meta_resume_loop,
}


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    require_explicit_environment(get_settings())
    try:
        await ensure_indexes(get_mongo_db())
        await ensure_run_indexes(get_mongo_db())
        await service_tokens.ensure_indexes(get_mongo_db())
    except Exception:  # MongoDB pas encore prêt : l'API démarre, /health/ready signalera l'état
        logger.exception("Création des index MongoDB impossible au démarrage")
    settings = get_settings()
    workers = [
        asyncio.create_task(_LOOPS[name](settings), name=name)
        for name in background_workers(settings)
    ]
    if not workers:
        logger.info("Aucune boucle de fond dans ce processus (HTTP seulement)")
    yield
    for worker in workers:
        worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker
    await dispose_engine()
    await close_clients()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    production = settings.environment == "production"
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
        # Pas de documentation interactive publique en production.
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    # Ajouté en dernier, donc le plus à l'extérieur : en-têtes aussi sur les réponses CORS et
    # les erreurs.
    app.add_middleware(HttpGuard, max_body_bytes=settings.max_request_bytes)
    register_error_handlers(app)
    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
