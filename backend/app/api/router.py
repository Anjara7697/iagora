from fastapi import APIRouter

from app.api.v1 import auth, campaigns, health, prospects, users

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(prospects.router)
api_router.include_router(campaigns.router)
# Restent à ajouter (CdC 9.6) : conversations, webhooks, rendez-vous.
