"""Modèles SQLAlchemy (PostgreSQL) - CdC 9.5. Schéma de référence : docs/database/.

Tous les modèles sont importés ici pour être enregistrés dans `Base.metadata` (Alembic).
"""

from app.models.appointment import Appointment
from app.models.campaign import Campaign, CampaignSource, CampaignTarget, Source, Target
from app.models.channel import Channel, ConsentEvent, ProspectChannel
from app.models.conversation import Conversation, Interaction, Message
from app.models.follow_up import FollowUp
from app.models.prospect import CampaignProspect, Prospect, StageEvent
from app.models.scoring import ScoreEvent
from app.models.user import User

__all__ = [
    "Appointment",
    "Campaign",
    "CampaignProspect",
    "CampaignSource",
    "CampaignTarget",
    "Channel",
    "ConsentEvent",
    "Conversation",
    "FollowUp",
    "Interaction",
    "Message",
    "Prospect",
    "ProspectChannel",
    "ScoreEvent",
    "Source",
    "StageEvent",
    "Target",
    "User",
]
