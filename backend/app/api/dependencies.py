import hashlib
from collections.abc import Callable
from functools import lru_cache
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, params, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.defaults import EmptyKnowledgeBase
from app.api.cookies import CSRF_HEADER, SESSION_COOKIE
from app.config import Settings, get_settings
from app.core.security import decode_access_claims, password_stamp
from app.database.clients import get_mongo_db
from app.database.session import get_session, get_sessionmaker
from app.graph.ports import Calendar, KnowledgeBase, LanguageModel
from app.integrations.email.base import EmailClient
from app.integrations.email.factory import create_email_client
from app.integrations.embeddings.base import EmbeddingError, EmbeddingModel
from app.integrations.embeddings.factory import create_embeddings
from app.integrations.knowledge.factory import create_knowledge_base
from app.integrations.llm.factory import create_language_model
from app.models import User
from app.models.enums import UserRole
from app.services import auth_sessions
from app.services import scope as scope_service

DbSession = Annotated[AsyncSession, Depends(get_session)]
MongoDb = Annotated[Any, Depends(get_mongo_db)]  # AsyncIOMotorDatabase


async def get_runtime_settings(
    base: Annotated[Settings, Depends(get_settings)], db: MongoDb
) -> Settings:
    """Réglages effectifs : ceux de la console (Paramètres) l'emportent sur le `.env`."""
    from app.services import runtime_settings

    return await runtime_settings.effective(db, base)


SettingsDep = Annotated[Settings, Depends(get_runtime_settings)]

# `auto_error=False` : sans en-tête `Authorization`, le jeton est lu dans le témoin de session.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentification requise",
    headers={"WWW-Authenticate": "Bearer"},
)
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def request_token(request: Request, bearer: str | None) -> tuple[str | None, bool]:
    """(jeton, lu dans le témoin ?). L'en-tête `Authorization` (scripts, n8n) l'emporte."""
    if bearer:
        return bearer, False
    cookie = request.cookies.get(SESSION_COOKIE)
    return (cookie, True) if cookie else (None, False)


async def get_current_user(
    request: Request,
    bearer: Annotated[str | None, Depends(oauth2_scheme)],
    session: DbSession,
    settings: SettingsDep,
) -> User:
    """Utilisateur du jeton. Le rôle est relu en base à chaque requête : une désactivation
    ou un changement de rôle prend effet immédiatement."""
    token, from_cookie = request_token(request, bearer)
    if not token:
        raise _UNAUTHORIZED
    # Écriture authentifiée par le témoin : l'en-tête anti-CSRF est exigé (AUDIT-SEC-004).
    if from_cookie and request.method not in _SAFE_METHODS and not request.headers.get(CSRF_HEADER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Requête refusée (origine)")
    claims = decode_access_claims(token, settings)
    if claims is None:
        raise _UNAUTHORIZED
    user = await session.get(User, claims.user_id)
    if user is None or not user.is_active:
        raise _UNAUTHORIZED
    # Jeton émis avant un changement de mot de passe : session révoquée.
    if claims.password_stamp != password_stamp(user.password_changed_at):
        raise _UNAUTHORIZED
    # Session fermée par une déconnexion (AUDIT-SEC-009).
    if not await auth_sessions.is_active(session, claims.session_id, user.id):
        raise _UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_scope(user: CurrentUser) -> "scope_service.Scope":
    """Périmètre de visibilité des prospects de l'utilisateur (décision D-23)."""
    return scope_service.for_user(user)


CurrentScope = Annotated["scope_service.Scope", Depends(get_scope)]


async def check_prospect_visible(prospect_id: int, session: DbSession, scope: CurrentScope) -> None:
    """À placer sur toute route `/{prospect_id}` : 404 hors du périmètre du conseiller."""
    await scope_service.ensure_visible(session, scope, prospect_id)


async def check_conversation_visible(
    conversation_id: str, session: DbSession, db: MongoDb, scope: CurrentScope
) -> None:
    """À placer sur toute route `/conversations/{conversation_id}` (même règle)."""
    if not scope.restricted:
        return
    from app.services import conversations

    doc = await conversations.get_doc(db, conversation_id)
    await scope_service.ensure_visible(session, scope, int(doc["prospect_id"]))


async def check_membership_visible(
    membership_id: int, session: DbSession, scope: CurrentScope
) -> None:
    """À placer sur toute route `/campaign-prospects/{membership_id}` (même règle)."""
    if not scope.restricted:
        return
    from app.models import CampaignProspect

    membership = await session.get(CampaignProspect, membership_id)
    if membership is not None:  # inexistant : la route répond elle-même 404
        await scope_service.ensure_visible(session, scope, membership.prospect_id)


VISIBLE_PROSPECT = Depends(check_prospect_visible)
VISIBLE_MEMBERSHIP = Depends(check_membership_visible)
VISIBLE_CONVERSATION = Depends(check_conversation_visible)


def require_roles(*roles: UserRole) -> params.Depends:
    allowed = frozenset(roles)

    async def _check(user: CurrentUser) -> User:
        if user.must_change_password:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Choisissez votre mot de passe (Mon compte) avant de continuer",
            )
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Droits insuffisants")
        return user

    dependency: params.Depends = Depends(_check)
    return dependency


# Matrice des droits (CdC §3.1, S-06) : lecture pour tous, écriture commerciale pour les
# conseillers, gestion (campagnes, comptes) pour les administrateurs.
ANY_ROLE = require_roles(UserRole.ADMIN, UserRole.ADVISOR, UserRole.VIEWER)
CAN_WRITE = require_roles(UserRole.ADMIN, UserRole.ADVISOR)
ADMIN_ONLY = require_roles(UserRole.ADMIN)


# --- Dépendances du workflow agentique (remplaçables dans les tests) ---


_CLIENTS: dict[tuple[Any, ...], Any] = {}


def _secret_digest(*values: Any) -> str:
    raw = "|".join(v.get_secret_value() if v is not None else "" for v in values)
    return hashlib.sha256(raw.encode()).hexdigest()


def _cached(key: tuple[Any, ...], build: Callable[[], Any]) -> Any:
    """Un client par configuration : changer de modèle ou de clé dans la console en recrée un."""
    if key not in _CLIENTS:
        if len(_CLIENTS) > 32:
            _CLIENTS.clear()
        _CLIENTS[key] = build()
    return _CLIENTS[key]


def get_language_model(settings: SettingsDep) -> LanguageModel:
    key = (
        "llm",
        settings.llm_provider,
        settings.llm_model,
        settings.llm_fallback_model,
        settings.llm_temperature,
        _secret_digest(settings.gemini_api_key, settings.openai_api_key),
    )
    model: LanguageModel = _cached(key, lambda: create_language_model(settings))
    return model


def get_session_factory() -> Callable[[], AsyncSession]:
    """Fabrique de sessions pour les tâches de fond (qui survivent à la requête)."""
    return get_sessionmaker()


@lru_cache
def _calendar() -> Calendar:
    from app.services.agenda import ConsoleCalendar

    return ConsoleCalendar(get_settings())


def get_calendar() -> Calendar:
    """Agenda de l'agent : réglé dans la console (à défaut le `.env`), relu à chaque demande.
    Non branché : la demande de rendez-vous est transférée au conseiller."""
    return _calendar()


async def get_email_client(settings: SettingsDep, db: MongoDb) -> EmailClient | None:
    """Client de la boîte email (console, à défaut `.env`), ou None si elle n'est pas configurée."""
    from app.services import email_config

    effective = await email_config.effective_settings(db, settings)
    return create_email_client(effective, require_enabled=False)


def get_embeddings(settings: SettingsDep) -> EmbeddingModel | None:
    def build() -> EmbeddingModel | None:
        try:
            return create_embeddings(settings)
        except EmbeddingError:
            return None

    key = (
        "emb",
        settings.embedding_provider,
        settings.embedding_model,
        _secret_digest(settings.gemini_api_key),
    )
    embeddings: EmbeddingModel | None = _cached(key, build)
    return embeddings


def get_knowledge_base(settings: SettingsDep) -> KnowledgeBase:
    def build() -> KnowledgeBase:
        kb = create_knowledge_base(settings, lambda: get_sessionmaker()())
        return kb if kb is not None else EmptyKnowledgeBase()

    key = (
        "kb",
        settings.embedding_provider,
        settings.embedding_model,
        _secret_digest(settings.gemini_api_key),
        settings.environment,
        settings.rag_min_score,
    )
    knowledge: KnowledgeBase = _cached(key, build)
    return knowledge


Llm = Annotated[LanguageModel, Depends(get_language_model)]
CalendarDep = Annotated[Calendar, Depends(get_calendar)]
KnowledgeDep = Annotated[KnowledgeBase, Depends(get_knowledge_base)]
SessionFactoryDep = Annotated[Callable[[], AsyncSession], Depends(get_session_factory)]
EmailDep = Annotated[EmailClient | None, Depends(get_email_client)]
EmbeddingsDep = Annotated[EmbeddingModel | None, Depends(get_embeddings)]
