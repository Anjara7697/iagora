from fastapi import APIRouter

from app.api.v1 import health

api_router = APIRouter()
api_router.include_router(health.router)
# Les routeurs metier (prospects, campaigns, ...) seront ajoutes ici - CdC 9.6.
