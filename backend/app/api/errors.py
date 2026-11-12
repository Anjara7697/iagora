import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.core.http_guard import REQUEST_ID
from app.services.errors import ConflictError, NotFoundError, ServiceError, ValidationFailure

logger = logging.getLogger(__name__)

_STATUS: dict[type[ServiceError], int] = {
    NotFoundError: status.HTTP_404_NOT_FOUND,
    ConflictError: status.HTTP_409_CONFLICT,
    ValidationFailure: 422,
}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def _handle(_: Request, exc: ServiceError) -> JSONResponse:
        code = _STATUS.get(type(exc), status.HTTP_400_BAD_REQUEST)
        return JSONResponse(status_code=code, content={"detail": exc.message})

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        # Détail dans les journaux uniquement : le client ne reçoit aucun message interne.
        logger.exception("Erreur non gérée", exc_info=exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            # La référence permet de retrouver la trace dans les journaux (AUDIT-API-002).
            content={"detail": "Erreur interne du serveur", "request_id": REQUEST_ID.get()},
        )
