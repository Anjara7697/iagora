from fastapi import APIRouter

from app.api.v1 import (
    agent,
    auth,
    calendar,
    campaign_prospects,
    campaigns,
    conversations,
    dashboard,
    demo,
    health,
    integrations,
    knowledge,
    prospects,
    simulation,
    todo,
    users,
    zoom,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(agent.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(users.advisors_router)
api_router.include_router(prospects.router)
api_router.include_router(campaigns.router)
api_router.include_router(campaigns.targets_router)
api_router.include_router(campaign_prospects.router)
api_router.include_router(conversations.router)
api_router.include_router(todo.router)
api_router.include_router(knowledge.router)
api_router.include_router(integrations.router)
api_router.include_router(calendar.admin_router)
api_router.include_router(calendar.router)
api_router.include_router(calendar.callback_router)
api_router.include_router(zoom.admin_router)
api_router.include_router(zoom.router)
api_router.include_router(zoom.callback_router)
api_router.include_router(demo.router)
api_router.include_router(simulation.router)
api_router.include_router(dashboard.router)
# Restent à ajouter (CdC 9.6) : webhooks, rendez-vous.
