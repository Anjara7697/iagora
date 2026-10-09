"""Erreurs métier, converties en réponses HTTP par la couche API."""


class ServiceError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(ServiceError):
    pass


class ConflictError(ServiceError):
    pass


class ValidationFailure(ServiceError):
    pass
