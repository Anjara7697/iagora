"""Enumérations métier. Valeurs stockées en texte + contrainte CHECK (pas d'ENUM natif PostgreSQL,
plus simple à faire évoluer par migration quand la liste change après validation métier, F-13)."""

from enum import StrEnum


class UserRole(StrEnum):  # S-06
    ADMIN = "ADMIN"
    ADVISOR = "ADVISOR"
    VIEWER = "VIEWER"


class CampaignStatus(StrEnum):  # F-01
    DRAFT = "draft"
    ACTIVE = "active"
    INACTIVE = "inactive"


class InterestLevel(StrEnum):  # F-12 : Froid, Tiède, Chaud, Très chaud
    COLD = "cold"
    WARM = "warm"
    HOT = "hot"
    VERY_HOT = "very_hot"


class ConversionStage(StrEnum):  # F-13
    NEW = "new"
    TO_QUALIFY = "to_qualify"
    CONTACTED = "contacted"
    IN_CONVERSATION = "in_conversation"
    QUALIFIED = "qualified"
    MEETING_PROPOSED = "meeting_proposed"
    MEETING_SCHEDULED = "meeting_scheduled"
    MEETING_DONE = "meeting_done"
    APPLIED = "applied"
    CONVERTED = "converted"
    TO_FOLLOW_UP = "to_follow_up"
    LOST = "lost"


class ConsentStatus(StrEnum):  # S-03
    UNKNOWN = "unknown"
    GRANTED = "granted"
    OPTED_OUT = "opted_out"


class ConsentEventType(StrEnum):
    GRANTED = "granted"
    WITHDRAWN = "withdrawn"


class ScoreType(StrEnum):  # CdC 9.3 : intérêt, adéquation, total
    INTEREST = "interest"
    FIT = "fit"
    TOTAL = "total"


class ConversationStatus(StrEnum):
    OPEN = "open"
    HANDED_OFF = "handed_off"
    CLOSED = "closed"


class SenderType(StrEnum):
    PROSPECT = "prospect"
    AGENT = "agent"
    ADVISOR = "advisor"


class Direction(StrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class FollowUpStatus(StrEnum):
    SCHEDULED = "scheduled"
    EXECUTED = "executed"
    CANCELLED = "cancelled"


class AppointmentStatus(StrEnum):
    PROPOSED = "proposed"
    SCHEDULED = "scheduled"
    DONE = "done"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class ScoringSignal(StrEnum):
    """Signaux d'engagement convertis en points par les règles de app/services/scoring.py."""

    MESSAGE_RECEIVED = "message_received"
    QUESTION_ASKED = "question_asked"
    POSITIVE_SENTIMENT = "positive_sentiment"
    NEGATIVE_SENTIMENT = "negative_sentiment"
    MEETING_REQUESTED = "meeting_requested"
    MEETING_DECLINED = "meeting_declined"
    NO_RESPONSE = "no_response"
    PROFILE_TARGET_MATCH = "profile_target_match"
    PROFILE_COMPLETED = "profile_completed"
