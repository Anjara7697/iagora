"""Simulateur de conversation : vous jouez le prospect, l'agent répond, la décision s'affiche."""

from collections.abc import Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agents.runtime import run_agent
from app.devtools.runner import new_demo_prospect
from app.graph.ports import Calendar, KnowledgeBase, LanguageModel
from app.models.enums import SenderType
from app.schemas.conversation import MessageCreate
from app.services import conversations, pipeline
from app.services.errors import ServiceError
from app.services.prospects import get_prospect

HELP = (
    "Écrivez comme le prospect. Commandes : /trace (détail des étapes), /state (état du prospect), "
    "/reset (nouveau prospect), /quit"
)


async def _state(session: AsyncSession, db: Any, pid: int, mid: int, cid: str) -> str:
    membership = await pipeline.get_membership(session, mid)
    prospect = await get_prospect(session, pid)
    conv = await conversations.get_conversation(db, cid)
    await session.refresh(membership)
    await session.refresh(prospect)
    return (
        f"  étape : {membership.conversion_stage.value} | score : {membership.total_score} "
        f"(intérêt {membership.interest_score}, adéquation {membership.fit_score}, "
        f"niveau {membership.interest_status.value if membership.interest_status else '-'})\n"
        f"  consentement : {prospect.consent_status.value} | conversation : {conv.status.value} "
        f"| profil : {prospect.profile or '-'}"
    )


async def chat_loop(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    *,
    llm: LanguageModel,
    calendar: Calendar,
    knowledge: KnowledgeBase,
    target_code: str = "ebihar_students",
    show_trace: bool = False,
    read: Callable[[str], str] = input,
    write: Callable[[str], None] = print,
) -> None:
    write(f"Simulateur de conversation — modèle : {llm.provider}/{llm.model}")
    write(HELP)
    async with session_factory() as session:
        pid, mid, cid = await new_demo_prospect(session, db, label="chat", target_code=target_code)
        while True:
            try:
                line = read("\nVous (prospect) > ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not line:
                continue
            if line == "/quit":
                break
            if line == "/trace":
                show_trace = not show_trace
                write(f"  trace détaillée : {'activée' if show_trace else 'désactivée'}")
                continue
            if line == "/state":
                write(await _state(session, db, pid, mid, cid))
                continue
            if line == "/reset":
                pid, mid, cid = await new_demo_prospect(
                    session, db, label="chat", target_code=target_code
                )
                write("  nouveau prospect créé")
                continue
            try:
                await conversations.add_message(
                    session, db, cid, MessageCreate(role=SenderType.PROSPECT, content=line)
                )
                result = await run_agent(
                    session,
                    db,
                    llm=llm,
                    calendar=calendar,
                    knowledge=knowledge,
                    conversation_id=cid,
                )
            except ServiceError as exc:
                write(f"  [{exc.message}] — tapez /reset pour recommencer")
                continue
            write(f"\nAgent > {result.reply}" if result.reply else "\nAgent > (aucun message)")
            write(f"  décision : {result.action} — {result.reason}")
            if result.handoff_reason:
                write(f"  transfert au conseiller : {result.handoff_reason}")
            write(await _state(session, db, pid, mid, cid))
            if show_trace:
                for entry in result.trace:
                    write(f"    · {entry.node} : {entry.summary}")
