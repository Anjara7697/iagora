from fastapi import APIRouter

from app.api.v1 import auth, campaign_prospects, campaigns, conversations, health, prospects, users

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(prospects.router)
api_router.include_router(campaigns.router)
api_router.include_router(campaign_prospects.router)
api_router.include_router(conversations.router)
# Restent à ajouter (CdC 9.6) : webhooks, rendez-vous.
