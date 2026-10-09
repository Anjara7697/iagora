from fastapi import APIRouter

from app.api.v1 import campaigns, health, prospects

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(prospects.router)
api_router.include_router(campaigns.router)
# Restent à ajouter (CdC 9.6) : conversations, webhooks, rendez-vous.
