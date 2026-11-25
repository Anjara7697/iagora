"""Apprendre des questions sans réponse (décision D-50).

Quand l'agent transfère une question absente de la base (« question_hors_base »), un conseiller
propose la réponse depuis la console ; un administrateur la relit, la corrige au besoin, puis la
valide. La réponse validée devient une section (`## question`) du document « Questions des
prospects » de son programme, ou du document commun : l'agent la retrouve dès la question suivante.

Rien n'entre dans la base sans validation d'un administrateur : une proposition refusée reste
dans l'historique avec son motif. Les propositions vivent dans MongoDB (`kb_suggestions`) : pas de
migration.
"""

import re
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import DESCENDING, ReturnDocument
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.embeddings.base import EmbeddingModel
from app.models import KnowledgeDocument, Target, User
from app.schemas.kb_suggestion import KbSuggestionPrefill, KbSuggestionRead
from app.services import conversations
from app.services import knowledge as knowledge_service
from app.services import scope as scope_service
from app.services.errors import ConflictError, NotFoundError, ValidationFailure

COLLECTION = "kb_suggestions"
PENDING, APPROVED, REJECTED = "pending", "approved", "rejected"
_CLAIMED = "approving"  # validation en cours : une seule à la fois par proposition
GAP_REASON = "question_hors_base"

FAQ_SLUG = "questions-prospects"
FAQ_TITLE = "Questions des prospects"
QUESTION_MAX = 200
ANSWER_MAX = 2000

Db = Any


def _now() -> datetime:
    return datetime.now(UTC)


async def ensure_indexes(db: Db) -> None:
    await db[COLLECTION].create_index([("status", 1), ("created_at", DESCENDING)])
    await db[COLLECTION].create_index("conversation_id")


def faq_slug(target_code: str | None) -> str:
    return f"{FAQ_SLUG}-{target_code}" if target_code else FAQ_SLUG


def _oid(suggestion_id: str) -> ObjectId:
    try:
        return ObjectId(suggestion_id)
    except (InvalidId, TypeError):
        raise NotFoundError("Proposition introuvable") from None


def clean_question(text: str) -> str:
    """Une ligne, sans marque de titre : la question devient l'intitulé de la section."""
    line = " ".join(text.split()).lstrip("#").strip()
    if len(line) < 5:
        raise ValidationFailure("Question trop courte")
    return line[:QUESTION_MAX]


def clean_answer(text: str) -> str:
    """Texte libre ; un « # » en début de ligne couperait la FAQ en sections : on le retire."""
    lines = [re.sub(r"^\s*#+\s*", "", line).rstrip() for line in text.strip().splitlines()]
    answer = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if len(answer.strip("-").strip()) < 5:
        raise ValidationFailure("Réponse trop courte")
    if len(answer) > ANSWER_MAX:
        raise ValidationFailure(f"Réponse trop longue ({ANSWER_MAX} caractères au plus)")
    return answer


async def _check_target(session: AsyncSession, target_code: str | None) -> Target | None:
    if not target_code:
        return None
    target = await session.scalar(select(Target).where(Target.code == target_code))
    if target is None:
        raise ValidationFailure("Programme inconnu")
    return target


def _read(doc: dict[str, Any], names: dict[int, str] | None = None) -> KbSuggestionRead:
    names = names or {}
    return KbSuggestionRead(
        id=str(doc["_id"]),
        status=doc["status"] if doc["status"] != _CLAIMED else PENDING,
        question=doc["question"],
        answer=doc["answer"],
        target_code=doc.get("target_code"),
        prospect_question=doc.get("prospect_question"),
        conversation_id=doc.get("conversation_id"),
        prospect_id=doc.get("prospect_id"),
        proposed_by=names.get(doc.get("proposed_by_id") or 0),
        created_at=doc["created_at"],
        decided_by=names.get(doc.get("decided_by_id") or 0),
        decided_at=doc.get("decided_at"),
        reason=doc.get("reason"),
        document_slug=doc.get("document_slug"),
    )


async def _names(session: AsyncSession, docs: list[dict[str, Any]]) -> dict[int, str]:
    ids = {i for d in docs for i in (d.get("proposed_by_id"), d.get("decided_by_id")) if i}
    if not ids:
        return {}
    users = await session.scalars(select(User).where(User.id.in_(ids)))
    return {u.id: u.username for u in users}


def _last_advisor_reply(doc: dict[str, Any]) -> str | None:
    """Réponse du conseiller écrite après le transfert : point de départ de la proposition."""
    since = (doc.get("handoff") or {}).get("created_at")
    for message in reversed(doc.get("messages", [])):
        if message.get("role") != "advisor":
            continue
        created = message.get("created_at")
        if since is not None and created is not None and created < since:
            return None
        return str(message.get("content") or "").strip() or None
    return None


async def prefill(db: Db, conversation_id: str) -> KbSuggestionPrefill:
    """Ce que la console pré-remplit : question du prospect, réponse du conseiller, programme."""
    doc = await conversations.get_doc(db, conversation_id)
    sheet = doc.get("handoff") or {}
    existing = await db[COLLECTION].find_one(
        {"conversation_id": conversation_id}, sort=[("created_at", DESCENDING)]
    )
    return KbSuggestionPrefill(
        question=(sheet.get("pending_question") or "")[:QUESTION_MAX],
        answer=(_last_advisor_reply(doc) or "")[:ANSWER_MAX],
        target_code=sheet.get("target_code"),
        existing=_read(existing) if existing else None,
    )


async def propose(
    session: AsyncSession,
    db: Db,
    *,
    conversation_id: str,
    question: str,
    answer: str,
    target_code: str | None,
    user: User,
) -> KbSuggestionRead:
    """Enregistre une proposition. Une seule en attente par conversation (409 sinon)."""
    doc = await conversations.get_doc(db, conversation_id)
    await _check_target(session, target_code)
    if await db[COLLECTION].find_one(
        {"conversation_id": conversation_id, "status": {"$in": [PENDING, _CLAIMED]}}
    ):
        raise ConflictError("Une proposition attend déjà la validation pour cette conversation")
    sheet = doc.get("handoff") or {}
    record = {
        "status": PENDING,
        "question": clean_question(question),
        "answer": clean_answer(answer),
        "target_code": target_code or None,
        "prospect_question": (sheet.get("pending_question") or None),
        "conversation_id": conversation_id,
        "prospect_id": int(doc["prospect_id"]),
        "proposed_by_id": user.id,
        "created_at": _now(),
    }
    result = await db[COLLECTION].insert_one(record)
    record["_id"] = result.inserted_id
    return _read(record, await _names(session, [record]))


async def list_suggestions(
    session: AsyncSession,
    db: Db,
    *,
    status: str | None,
    conversation_id: str | None,
    limit: int,
    prospect_ids: list[int] | None = None,
) -> tuple[list[KbSuggestionRead], int]:
    match: dict[str, Any] = {}
    if status == PENDING:
        match["status"] = {"$in": [PENDING, _CLAIMED]}
    elif status:
        match["status"] = status
    if conversation_id:
        match["conversation_id"] = conversation_id
    match.update(scope_service.mongo_match(prospect_ids))
    total = await db[COLLECTION].count_documents(match)
    docs = [
        d async for d in db[COLLECTION].find(match).sort([("created_at", DESCENDING)]).limit(limit)
    ]
    names = await _names(session, docs)
    return [_read(d, names) for d in docs], total


def merge_section(source: str | None, title: str, target_code: str | None, q: str, a: str) -> str:
    """Ajoute la section `## q` à la FAQ, ou remplace celle qui porte déjà ce titre."""
    if not source:
        header = f"---\ntitle: {title}\ntarget: {target_code or 'all'}\n---\n"
        return f"{header}\n## {q}\n{a}\n"
    lines = source.rstrip("\n").splitlines()
    wanted = q.casefold()
    start = next(
        (i for i, line in enumerate(lines)
         if line.startswith("## ") and line[3:].strip().casefold() == wanted),
        None,
    )  # fmt: skip
    if start is None:
        return "\n".join(lines) + f"\n\n## {q}\n{a}\n"
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    replaced = [*lines[:start], f"## {q}", *a.splitlines()]
    rest = lines[end:]
    return "\n".join(replaced + ([""] + rest if rest else [])) + "\n"


async def approve(
    session: AsyncSession,
    db: Db,
    embeddings: EmbeddingModel,
    suggestion_id: str,
    *,
    question: str | None,
    answer: str | None,
    target_code: str | None,
    keep_target: bool,
    user: User,
) -> KbSuggestionRead:
    """Valide (après correction éventuelle) et ajoute la réponse à la FAQ du programme."""
    oid = _oid(suggestion_id)
    current = await db[COLLECTION].find_one({"_id": oid})
    if current is None:
        raise NotFoundError("Proposition introuvable")
    q = clean_question(question if question is not None else current["question"])
    a = clean_answer(answer if answer is not None else current["answer"])
    code = current.get("target_code") if keep_target else (target_code or None)
    target = await _check_target(session, code)
    claimed = await db[COLLECTION].find_one_and_update(
        {"_id": oid, "status": PENDING},
        {"$set": {"status": _CLAIMED}},
        return_document=ReturnDocument.AFTER,
    )
    if claimed is None:
        raise ConflictError("Proposition déjà traitée")
    slug = faq_slug(code)
    title = f"{FAQ_TITLE} — {target.name}" if target else FAQ_TITLE
    try:
        existing = await session.scalar(
            select(KnowledgeDocument).where(KnowledgeDocument.slug == slug)
        )
        raw = merge_section(existing.source_text if existing else None, title, code, q, a)
        await knowledge_service.ingest_document(session, embeddings, slug, raw)
    except BaseException:
        await db[COLLECTION].update_one(
            {"_id": oid, "status": _CLAIMED}, {"$set": {"status": PENDING}}
        )
        raise
    changes = {
        "status": APPROVED,
        "question": q,
        "answer": a,
        "target_code": code,
        "decided_by_id": user.id,
        "decided_at": _now(),
        "document_slug": slug,
        "edited": q != current["question"]
        or a != current["answer"]
        or code != current.get("target_code"),
    }
    await db[COLLECTION].update_one({"_id": oid}, {"$set": changes})
    done = {**claimed, **changes}
    return _read(done, await _names(session, [done]))


async def reject(
    session: AsyncSession, db: Db, suggestion_id: str, *, reason: str | None, user: User
) -> KbSuggestionRead:
    done = await db[COLLECTION].find_one_and_update(
        {"_id": _oid(suggestion_id), "status": PENDING},
        {
            "$set": {
                "status": REJECTED,
                "reason": (reason or "").strip()[:300] or None,
                "decided_by_id": user.id,
                "decided_at": _now(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if done is None:
        if await db[COLLECTION].find_one({"_id": _oid(suggestion_id)}) is None:
            raise NotFoundError("Proposition introuvable")
        raise ConflictError("Proposition déjà traitée")
    return _read(done, await _names(session, [done]))
