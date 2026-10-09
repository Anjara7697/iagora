"""Exécute des scénarios de bout en bout : prospect, conversation, messages, agent, vérifications."""

import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agents.runtime import run_agent
from app.devtools.fakes import FakeCalendar, FakeKnowledge, FakeLLM
from app.devtools.scenarios import ANY, Expect, Scenario
from app.graph import policy
from app.graph.ports import Calendar, KnowledgeBase, LanguageModel
from app.graph.state import Qualification
from app.models import Appointment, Campaign, FollowUp
from app.models.enums import CampaignStatus, FollowUpStatus, SenderType
from app.schemas.agent import AgentRunResult
from app.schemas.campaign import CampaignCreate, SourceInput
from app.schemas.conversation import ConversationCreate, MessageCreate
from app.schemas.prospect import ProspectIngest
from app.services import campaigns, conversations, follow_ups, pipeline, prospects
from app.services.prospects import get_prospect

DEMO_DOMAIN = "demo.example.com"
SCENARIO_CAMPAIGN = "[DÉMO] Scénarios de recette"
# Messages rédigés par le code (pas par le modèle) : exclus de la vérification des chiffres.
CODE_WRITTEN_MODES = {"meeting_proposal", "meeting_confirmation", "handoff"}


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class TurnReport:
    says: str | None
    action: str = ""
    reason: str = ""
    reply: str | None = None
    handoff_reason: str | None = None
    stage_after: str | None = None
    checks: list[Check] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(c.ok for c in self.checks)


@dataclass
class ScenarioReport:
    scenario: Scenario
    turns: list[TurnReport] = field(default_factory=list)
    skipped: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.skipped is None and self.error is None and all(t.ok for t in self.turns)


async def ensure_demo_campaign(
    session: AsyncSession, name: str = SCENARIO_CAMPAIGN
) -> tuple[int, int]:
    """Campagne de démonstration avec une source ; retourne (campagne, source). Idempotent."""
    existing = await session.scalar(select(Campaign).where(Campaign.name == name))
    if existing is None:
        existing = await campaigns.create_campaign(
            session,
            CampaignCreate(
                name=name,
                status=CampaignStatus.ACTIVE,
                target_codes=["ebihar_students"],
                sources=[SourceInput(name="Source de démonstration", type="demo", platform="demo")],
            ),
        )
    read = await campaigns.to_read(session, existing)
    return read.id, read.sources[0].id


async def new_demo_prospect(
    session: AsyncSession,
    db: Any,
    *,
    label: str,
    target_code: str = "ebihar_students",
    profile: dict[str, Any] | None = None,
    first_name: str = "Camille",
) -> tuple[int, int, str]:
    """Prospect fictif + conversation ouverte sur l'email. Retourne (prospect, rattachement, conversation)."""
    campaign_id, source_id = await ensure_demo_campaign(session)
    token = secrets.token_hex(3)
    prospect, _, _ = await prospects.ingest_prospect(
        session,
        ProspectIngest(
            first_name=first_name,
            email=f"{label}.{token}@{DEMO_DOMAIN}",
            channel="email",
            target_code=target_code,
            campaign_id=campaign_id,
            source_id=source_id,
            profile=profile or {},
        ),
    )
    memberships = await prospects.get_memberships(session, prospect.id)
    conv, _ = await conversations.create_conversation(
        session, db, ConversationCreate(prospect_id=prospect.id, channel="email")
    )
    return prospect.id, memberships[0].id, conv.id


# --- Vérifications ---


def _check(name: str, ok: bool, detail: str = "") -> Check:
    return Check(name, ok, "" if ok else detail)


def evaluate(
    expect: Expect, result: AgentRunResult, observed: dict[str, Any], agent_texts: list[str]
) -> list[Check]:
    checks: list[Check] = []
    if expect.action is not None:
        checks.append(
            _check(
                "action",
                result.action == expect.action,
                f"{result.action!r} au lieu de {expect.action!r}",
            )
        )
    if expect.action_in:
        checks.append(
            _check(
                "action",
                result.action in expect.action_in,
                f"{result.action!r} hors de {expect.action_in}",
            )
        )
    if expect.stage_in:
        checks.append(
            _check(
                "étape",
                observed["stage"] in expect.stage_in,
                f"{observed['stage']!r} hors de {expect.stage_in}",
            )
        )
    if expect.handoff_reason is not ANY:
        checks.append(
            _check(
                "motif de transfert",
                result.handoff_reason == expect.handoff_reason,
                f"{result.handoff_reason!r} au lieu de {expect.handoff_reason!r}",
            )
        )
    if expect.reply is not None:
        has_reply = bool(result.reply)
        checks.append(
            _check(
                "message rédigé" if expect.reply else "aucun message",
                has_reply == expect.reply,
                f"réponse : {result.reply!r}",
            )
        )
    text = " ".join(agent_texts).lower()
    for needle in expect.reply_includes:
        checks.append(_check(f"contient « {needle} »", needle.lower() in text, "absent du message"))
    for needle in expect.reply_excludes:
        checks.append(
            _check(
                f"ne contient pas « {needle} »",
                needle.lower() not in text,
                "présent dans le message",
            )
        )
    if expect.stage_after is not None:
        checks.append(
            _check(
                "étape",
                observed["stage"] == expect.stage_after,
                f"{observed['stage']!r} au lieu de {expect.stage_after!r}",
            )
        )
    if expect.consent is not None:
        checks.append(
            _check(
                "consentement", observed["consent"] == expect.consent, f"{observed['consent']!r}"
            )
        )
    if expect.conversation is not None:
        checks.append(
            _check(
                "conversation",
                observed["conversation"] == expect.conversation,
                f"{observed['conversation']!r}",
            )
        )
    if expect.appointment is not None:
        checks.append(
            _check(
                "rendez-vous créé",
                (observed["appointments"] > 0) == expect.appointment,
                f"{observed['appointments']} rendez-vous",
            )
        )
    if expect.follow_up is not None:
        checks.append(
            _check(
                "relance programmée",
                (observed["follow_ups"] > 0) == expect.follow_up,
                f"{observed['follow_ups']} relance(s)",
            )
        )
    for key in expect.profile_keys:
        checks.append(
            _check(
                f"profil : {key}",
                bool(observed["profile"].get(key)),
                f"profil = {observed['profile']}",
            )
        )
    # Vérifications valables pour TOUS les scénarios.
    checks.append(_check("décision justifiée", bool(result.reason.strip()), "justification vide"))
    checks.append(_check("trace présente", len(result.trace) >= 3, "trace vide"))
    return checks


async def _observe(
    session: AsyncSession, db: Any, pid: int, mid: int, cid: str
) -> tuple[dict[str, Any], list[str], list[str]]:
    membership = await pipeline.get_membership(session, mid)
    prospect = await get_prospect(session, pid)
    await session.refresh(membership)
    await session.refresh(prospect)
    conv = await conversations.get_conversation(db, cid)
    appointments = await session.scalar(
        select(func.count()).select_from(Appointment).where(Appointment.prospect_id == pid)
    )
    follow_ups = await session.scalar(
        select(func.count())
        .select_from(FollowUp)
        .where(FollowUp.prospect_id == pid, FollowUp.status == FollowUpStatus.SCHEDULED)
    )
    observed = {
        "stage": membership.conversion_stage.value,
        "consent": prospect.consent_status.value,
        "conversation": conv.status.value,
        "appointments": appointments or 0,
        "follow_ups": follow_ups or 0,
        "profile": dict(prospect.profile or {}),
    }
    # Messages de l'agent écrits après le dernier message du prospect.
    tail: list[str] = []
    llm_written: list[str] = []
    for m in reversed(conv.messages):
        if m.role == SenderType.PROSPECT:
            break
        tail.append(m.content)
        if m.metadata.get("mode") not in CODE_WRITTEN_MODES:
            llm_written.append(m.content)
    return observed, tail, llm_written


async def run_scenario(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    scenario: Scenario,
    *,
    llm: LanguageModel,
    calendar: Calendar | None = None,
    knowledge: KnowledgeBase | None = None,
) -> ScenarioReport:
    report = ScenarioReport(scenario)
    scripted = isinstance(llm, FakeLLM)
    if scenario.fake_only and not scripted:
        report.skipped = "nécessite le faux modèle (panne à injecter)"
        return report
    kb = knowledge or FakeKnowledge(list(scenario.knowledge))
    cal = calendar or FakeCalendar()
    try:
        async with session_factory() as session:
            pid, mid, cid = await new_demo_prospect(
                session,
                db,
                label=scenario.name,
                target_code=scenario.target_code,
                profile=scenario.profile,
            )
            if scenario.preset_follow_up:
                await follow_ups.schedule_follow_up(
                    session, pid, mid, None, timedelta(days=3), "relance de précaution (recette)"
                )
            for turn in scenario.turns:
                if turn.says is not None:
                    await conversations.add_message(
                        session, db, cid, MessageCreate(role=SenderType.PROSPECT, content=turn.says)
                    )
                if scripted:
                    assert isinstance(llm, FakeLLM)
                    llm.qualification = turn.qualification or Qualification(intent="other")
                    llm.reply = turn.reply or "Bonjour, merci pour votre message."
                result = await run_agent(
                    session, db, llm=llm, calendar=cal, knowledge=kb, conversation_id=cid
                )
                observed, tail, llm_written = await _observe(session, db, pid, mid, cid)
                tr = TurnReport(
                    says=turn.says,
                    action=result.action,
                    reason=result.reason,
                    reply=result.reply,
                    handoff_reason=result.handoff_reason,
                    stage_after=observed["stage"],
                )
                tr.checks = evaluate(turn.expect, result, observed, tail)
                if (
                    result.handoff_reason == "llm_indisponible"
                    and turn.expect.handoff_reason != "llm_indisponible"
                ):
                    # Rend la cause visible dans le rapport (quota, clé, réseau…).
                    cause = next(
                        (t.summary for t in result.trace if "modèle indisponible" in t.summary), ""
                    )
                    tr.checks.append(_check("modèle de langage joignable", False, cause))
                # NF-10 : aucun chiffre non sourcé dans ce que le modèle a rédigé.
                sources = [p.text for p in kb.passages] if isinstance(kb, FakeKnowledge) else []
                sources += [turn.says or ""]
                claims = [c for t in llm_written for c in policy.ungrounded_claims(t, sources)]
                tr.checks.append(
                    _check("aucun chiffre inventé (NF-10)", not claims, f"non sourcés : {claims}")
                )
                report.turns.append(tr)
                if result.action in {"opt_out", "close"} or observed["conversation"] != "open":
                    break
    except Exception as exc:  # une erreur technique est un échec du scénario, pas un plantage
        report.error = f"{type(exc).__name__}: {exc}"
    return report


async def run_all(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    scenarios: list[Scenario],
    *,
    llm: LanguageModel,
    on_done: Callable[[ScenarioReport], None] | None = None,
) -> list[ScenarioReport]:
    reports = []
    for scenario in scenarios:
        r = await run_scenario(session_factory, db, scenario, llm=llm)
        reports.append(r)
        if on_done:
            on_done(r)
    return reports


# --- Rapport ---


def format_console(r: ScenarioReport) -> str:
    if r.skipped:
        return f"  ~  {r.scenario.name:<28} ignoré : {r.skipped}"
    if r.error:
        return f"  !  {r.scenario.name:<28} erreur : {r.error}"
    mark = "OK" if r.ok else "KO"
    lines = [f" {mark}  {r.scenario.name:<28} {r.scenario.title}"]
    for i, t in enumerate(r.turns, 1):
        for c in t.checks:
            if not c.ok:
                lines.append(f"        tour {i} : {c.name} : {c.detail}")
    return "\n".join(lines)


def format_markdown(reports: list[ScenarioReport], *, mode: str, model: str) -> str:
    ran = [r for r in reports if r.skipped is None]
    passed = sum(1 for r in ran if r.ok)
    out = [
        "# Rapport de recette de l'agent",
        "",
        f"- Mode : **{mode}** — modèle : `{model}`",
        f"- Résultat : **{passed}/{len(ran)}** scénarios conformes"
        + (f" ({len(reports) - len(ran)} ignoré(s))" if len(ran) != len(reports) else ""),
        "",
        "| Scénario | Référence | Résultat | Écarts |",
        "|---|---|---|---|",
    ]
    for r in reports:
        if r.skipped:
            out.append(f"| {r.scenario.name} | {r.scenario.cdc_ref} | ignoré | {r.skipped} |")
            continue
        gaps = r.error or "; ".join(
            f"tour {i} : {c.name} ({c.detail})"
            for i, t in enumerate(r.turns, 1)
            for c in t.checks
            if not c.ok
        )
        out.append(
            f"| {r.scenario.name} | {r.scenario.cdc_ref} | {'conforme' if r.ok else 'ÉCART'} | {gaps or '-'} |"
        )
    out += ["", "## Détail des échanges", ""]
    for r in reports:
        if r.skipped:
            continue
        out.append(f"### {r.scenario.name} — {r.scenario.title}")
        for i, t in enumerate(r.turns, 1):
            out.append(f"**Tour {i}.** Prospect : « {t.says or '(premier contact)'} »")
            out.append(f"- Décision : `{t.action}` — {t.reason}")
            if t.handoff_reason:
                out.append(f"- Transfert : `{t.handoff_reason}`")
            out.append(
                f"- Réponse de l'agent : {('« ' + t.reply + ' »') if t.reply else '(aucun message)'}"
            )
            out.append(f"- Étape après : `{t.stage_after}`")
        out.append("")
    return "\n".join(out)
