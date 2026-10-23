import hashlib
from collections.abc import Callable
from functools import lru_cache
from typing import Annotated, Any

from fastapi import Depends, HTTPException, params, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.defaults import EmptyKnowledgeBase
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

DbSession = Annotated[AsyncSession, Depends(get_session)]
MongoDb = Annotated[Any, Depends(get_mongo_db)]  # AsyncIOMotorDatabase


async def get_runtime_settings(
    base: Annotated[Settings, Depends(get_settings)], db: MongoDb
) -> Settings:
    """Réglages effectifs : ceux de la console (Paramètres) l'emportent sur le `.env`."""
    from app.services import runtime_settings

    return await runtime_settings.effective(db, base)


SettingsDep = Annotated[Settings, Depends(get_runtime_settings)]

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentification requise",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)], session: DbSession, settings: SettingsDep
) -> User:
    """Utilisateur du jeton. Le rôle est relu en base à chaque requête : une désactivation
    ou un changement de rôle prend effet immédiatement."""
    claims = decode_access_claims(token, settings)
    if claims is None:
        raise _UNAUTHORIZED
    user = await session.get(User, claims[0])
    if user is None or not user.is_active:
        raise _UNAUTHORIZED
    # Jeton émis avant un changement de mot de passe : session révoquée.
    if claims[1] != password_stamp(user.password_changed_at):
        raise _UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


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
