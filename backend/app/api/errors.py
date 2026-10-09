from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.services.errors import ConflictError, NotFoundError, ServiceError, ValidationFailure

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
