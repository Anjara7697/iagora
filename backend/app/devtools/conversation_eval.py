"""Évaluation de conversations (`python -m app.cli eval-conversations`).

`eval-agent` mesure l'agent message par message, sur un prospect neuf à chaque fois. Ce module joue
des CONVERSATIONS de plusieurs messages (`conversation_cases.json`) sur un même prospect fictif et
mesure ce qui ne se voit qu'à la longue :

- chaque tour, avec les mêmes vérifications que `eval-agent` (intention, décision, transfert, fait
  attendu, chiffres non sourcés) : `evaluation.play_turn` est réutilisé tel quel ;
- le suivi du contexte (« et ça dure combien ? ») ;
- les informations redemandées alors que le prospect les a déjà données ;
- le ton sur la durée : nouvelle salutation, présentation comme IA sans qu'on le demande, plus
  d'une question par message ;
- l'état final du parcours (rendez-vous réservé, désinscription, transfert…).

Rien n'est envoyé : prospects fictifs (`evalconv.*@demo.example.com`), agenda de démonstration,
base de connaissances FICTIVE. Hors ligne, le faux modèle rejoue l'annotation de chaque tour ; les
conversations `live_only` (suivi du contexte) ne sont jouées qu'avec le vrai modèle.
"""

import asyncio
import json
import re
import statistics
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.devtools import runner
from app.devtools.evaluation import (
    CHARS_PER_TOKEN,
    CaseResult,
    EvalCase,
    LexicalKnowledge,
    MeteredLLM,
    Rate,
    _fmt_seconds,
    _gaps,
    _mark,
    _rate,
    play_turn,
)
from app.devtools.fakes import FakeCalendar, FakeLLM, _tokens
from app.graph import policy
from app.graph.ports import KnowledgeBase, LanguageModel

CASES_FILE = Path(__file__).parent / "conversation_cases.json"
LABEL = "evalconv"  # adresses fictives : evalconv.<jeton>@demo.example.com


# --- Jeu de conversations ---


@dataclass
class Turn:
    says: str
    intents: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    handoff: bool | None = None
    handoff_reasons: list[str] = field(default_factory=list)
    must_mention: list[str] = field(default_factory=list)
    known: list[str] = field(default_factory=list)  # profil déjà donné : ne plus le demander
    context: bool = False  # ne se comprend qu'avec les messages précédents
    asks_ai: bool = False  # question directe : l'agent peut (doit) dire qu'il est une IA
    # Profil attendu APRÈS ce tour : champ -> « a|b » (l'un ou l'autre, sur le texte normalisé).
    profile_after: dict[str, str] = field(default_factory=dict)
    fake: dict[str, Any] = field(default_factory=dict)


@dataclass
class Conversation:
    id: str
    title: str
    turns: list[Turn]
    target: str = "ebihar_students"
    profile: dict[str, str] = field(default_factory=dict)
    live_only: bool = False
    end: dict[str, Any] = field(default_factory=dict)
    # L'agent devrait proposer un rendez-vous de lui-même au plus tard à ce tour (indicateur).
    meeting_by: int | None = None

    def case(self, index: int) -> EvalCase:
        """Le tour `index` vu comme un cas de `eval-agent` (mêmes vérifications)."""
        t = self.turns[index]
        return EvalCase(
            id=f"{self.id}#{index + 1}",
            category=self.id,
            message=t.says,
            target=self.target,
            intents=t.intents,
            actions=t.actions,
            handoff=t.handoff,
            handoff_reasons=t.handoff_reasons,
            must_mention=t.must_mention,
            fake=t.fake,
        )


def load_conversations(
    ids: Sequence[str] | None = None, path: Path = CASES_FILE
) -> list[Conversation]:
    data = json.loads(path.read_text(encoding="utf-8"))
    convs = [
        Conversation(**{**raw, "turns": [Turn(**t) for t in raw["turns"]]})
        for raw in data["conversations"]
    ]
    if ids:
        by_id = {c.id: c for c in convs}
        unknown = [i for i in ids if i not in by_id]
        if unknown:
            raise KeyError(
                f"Conversation(s) inconnue(s) : {unknown}. Disponibles : {sorted(by_id)}"
            )
        convs = [by_id[i] for i in ids]
    return convs


# --- Ce qui ne se voit qu'à la longue ---

_GREETING = re.compile(r"^\W*(bonjour|bonsoir|salut|hello)\b")
_AI_SELF = re.compile(
    r"\bje suis (un |une |l')?(assistant|ia\b|intelligence artificielle|robot|agent virtuel)"
    r"|\ben tant qu'(ia|intelligence artificielle|assistant)"
)
# Questions sur une information du profil (`policy.FIELD_LABELS`), sur le texte normalisé.
_ASKS_FIELD = {
    "study_level": r"niveau d.?etudes|quel diplome|votre diplome|votre formation actuelle",
    "field_of_study": r"domaine d.?etudes|quelle filiere",
    "current_situation": r"situation (professionnelle|actuelle)|votre poste actuel|votre metier",
    "goal": r"votre projet|qu.est.ce qui vous amene|que recherchez|votre objectif",
    "availability": r"disponibilites|quand souhaitez|a quelle echeance",
    "company_need": r"profils? recherches?|quelles competences",
}


def repeats_greeting(message: str) -> bool:
    """Un message (après le premier de l'agent) qui salue à nouveau."""
    return bool(_GREETING.search(policy.normalize(message)))


def introduces_itself_as_ai(message: str) -> bool:
    """« Je suis une IA / un assistant… » écrit de lui-même par l'agent (D-32)."""
    return bool(_AI_SELF.search(policy.normalize(message)))


def asked_fields(message: str) -> list[str]:
    """Informations de profil que le message DEMANDE (dans une phrase interrogative)."""
    questions = [q for q in re.split(r"(?<=[.!?])\s+", policy.normalize(message)) if "?" in q]
    return [
        f for f, pattern in _ASKS_FIELD.items() if any(re.search(pattern, q) for q in questions)
    ]


def question_count(message: str) -> int:
    return message.count("?")


# --- Technique de vente (indicateurs : comptés à part, hors conformité) ---

_EXPLORE = re.compile(
    r"qu.est.ce qu|pourquoi|comment|que recherchez|qu.attendez|que souhaitez|ce qui vous"
    r"|ce que vous|qu.aimeriez"
)
_INFORM = re.compile(
    r"\bquel(le)?s?\b|combien|quand|\bou\b"
    r"|(m|nous).(indiquer|preciser|dire|communiquer)\b"  # « pourriez-vous m'indiquer votre… »
)
_ALTERNATIVE = re.compile(r"\w \bou\b \w")
_REFORMULATION = re.compile(
    r"si je (comprends|resume)|vous me dites|d.apres ce que vous|vous (visez|souhaitez|cherchez"
    r"|recherchez|voulez) donc|avec votre (profil|bts|licence|experience|parcours)"
    r"|votre (projet|objectif) (est|de)|vous (etes|avez) (donc|actuellement)"
)
_ADVISOR_OFFER = re.compile(r"conseiller|rendez.vous|mettre? en relation|echange")
_ELIGIBILITY = re.compile(
    r"correspond\w* (bien |parfaitement |tout a fait )?(aux|a nos) (conditions|criteres|prerequis)"
    r"|vous remplissez|vous etes eligible|votre profil (correspond|est (tout a fait |parfaitement )?"
    r"(coherent|adapte|compatible))|(tout a fait |parfaitement )coherent avec"
)
LONG_MESSAGE_WORDS = 120  # la consigne de l'agent : 120 mots au plus


def questions_of(message: str) -> list[str]:
    return [q for q in re.split(r"(?<=[.!?])\s+", policy.normalize(message)) if "?" in q]


def question_kind(question: str) -> str:
    """Type d'une question : `exploration` (motivation, projet : qu'est-ce qui, pourquoi,
    comment), `information` (un fait : quel, combien, quand), `alternative` (X ou Y ?) ou
    `fermée` (oui ou non : souhaitez-vous…). Repérage par expressions, sur le texte normalisé."""
    q = policy.normalize(question)
    if _ALTERNATIVE.search(q) and not re.match(r"^\W*(ou|d.ou)\b", q):
        return "alternative"
    if _EXPLORE.search(q):
        return "exploration"
    if _INFORM.search(q):
        return "information"
    return "fermée"


def reformulates(prospect: str, message: str) -> bool:
    """L'agent reprend ce que le prospect vient de dire avant d'enchaîner (écoute active) :
    formule de reformulation, ou première phrase (hors salutation) qui reprend au moins deux mots
    significatifs d'un message du prospect qui n'était pas une question."""
    text = policy.normalize(message)
    if _REFORMULATION.search(text):
        return True
    if "?" in prospect:
        return False
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", text) if not _GREETING.search(s)]
    return bool(sentences) and len(_tokens(sentences[0]) & _tokens(prospect)) >= 2


def offers_advisor(message: str) -> bool:
    """Le message propose un échange avec un conseiller, sous forme de question."""
    return any(_ADVISOR_OFFER.search(q) for q in questions_of(message))


def gives_eligibility_verdict(message: str) -> bool:
    """« Votre profil correspond aux conditions d'admission » : l'admission revient à l'école."""
    return bool(_ELIGIBILITY.search(policy.normalize(message)))


def profile_matches(profile: dict[str, Any], expected: dict[str, str]) -> bool:
    """Le profil lu contient, pour chaque champ attendu, l'une des formulations « a|b »."""
    for name, alternatives in expected.items():
        value = policy.normalize(str(profile.get(name) or ""))
        if not any(policy.normalize(a).strip() in value for a in alternatives.split("|")):
            return False
    return True


# --- Exécution ---


@dataclass
class ConversationResult:
    conversation: Conversation
    turns: list[CaseResult] = field(default_factory=list)
    transcript: list[tuple[str, str]] = field(default_factory=list)  # (rôle, texte)
    reasked: list[str] = field(default_factory=list)  # « tour n : champ »
    greetings_repeated: int = 0
    ai_self_intros: int = 0
    multi_questions: int = 0
    agent_messages: int = 0  # messages rédigés par le modèle
    profile_checks: list[bool | None] = field(default_factory=list)  # un par tour joué
    # Indicateurs de technique de vente (hors conformité).
    question_kinds: list[str] = field(default_factory=list)
    reformulations: int = 0
    words: list[int] = field(default_factory=list)
    advisor_offers: int = 0
    eligibility_verdicts: int = 0
    template_greetings: int = 0
    meeting_turn: int | None = None  # premier tour où l'agent propose ou réserve un rendez-vous
    final: dict[str, Any] = field(default_factory=dict)
    stopped_early: bool = False  # la conversation s'est arrêtée avant le dernier tour
    seconds: float = 0.0
    skipped: str | None = None
    error: str | None = None

    @property
    def llm_unavailable(self) -> bool:
        return any(t.llm_unavailable for t in self.turns)

    @property
    def evaluable(self) -> bool:
        return (
            self.skipped is None
            and self.error is None
            and not self.llm_unavailable
            and all(t.error is None for t in self.turns)
        )

    @property
    def end_ok(self) -> bool | None:
        end = self.conversation.end
        if not end or not self.final:
            return None
        checks = []
        if "stage_in" in end:
            checks.append(self.final.get("stage") in end["stage_in"])
        if "conversation" in end:
            checks.append(self.final.get("conversation") == end["conversation"])
        if "consent" in end:
            checks.append(self.final.get("consent") == end["consent"])
        if "appointment" in end:
            checks.append(bool(self.final.get("appointments")) == end["appointment"])
        return all(checks)

    @property
    def profile_ok(self) -> bool | None:
        applicable = [c for c in self.profile_checks if c is not None]
        return all(applicable) if applicable else None

    @property
    def repeated_offers(self) -> int:
        return max(0, self.advisor_offers - 1)

    @property
    def meeting_on_time(self) -> bool | None:
        """Rendez-vous proposé par l'agent au plus tard au tour `meeting_by` (indicateur)."""
        by = self.conversation.meeting_by
        if by is None or not self.evaluable:
            return None
        return self.meeting_turn is not None and self.meeting_turn <= by

    @property
    def style_ok(self) -> bool:
        return not (
            self.reasked or self.greetings_repeated or self.ai_self_intros or self.multi_questions
        )

    @property
    def ok(self) -> bool:
        return (
            self.evaluable
            and not self.stopped_early
            and all(t.ok for t in self.turns)
            and self.profile_ok is not False
            and self.style_ok
            and self.end_ok is not False
        )


def _measure(result: ConversationResult, index: int, turn: Turn, r: CaseResult) -> None:
    """Ce qui ne se voit qu'à la longue, et les indicateurs de technique de vente, à ce tour."""
    if result.meeting_turn is None and r.action in ("propose_meeting", "book_meeting"):
        result.meeting_turn = index + 1
    result.profile_checks.append(
        profile_matches(r.observed.get("profile") or {}, turn.profile_after)
        if turn.profile_after
        else None
    )
    seen_before = sum(1 for role, _ in result.transcript if role == "agent") - len(r.agent_messages)
    written = set(r.llm_written)
    for n, message in enumerate(r.agent_messages):
        if seen_before + n == 0 or not repeats_greeting(message):
            continue
        if message in written:
            result.greetings_repeated += 1  # rédigé par le modèle : compte dans la conformité
        else:
            result.template_greetings += 1  # texte fixe (créneaux, confirmation) : indicateur
    for message in r.llm_written:
        result.agent_messages += 1
        if not turn.asks_ai and introduces_itself_as_ai(message):
            result.ai_self_intros += 1
        if question_count(message) > 1:
            result.multi_questions += 1
        result.reasked += [
            f"tour {index + 1} : {f}" for f in asked_fields(message) if f in turn.known
        ]
        result.question_kinds += [question_kind(q) for q in questions_of(message)]
        result.reformulations += reformulates(turn.says, message)
        result.words.append(len(message.split()))
        result.advisor_offers += offers_advisor(message)
        result.eligibility_verdicts += gives_eligibility_verdict(message)


async def run_conversation(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    conv: Conversation,
    *,
    llm: MeteredLLM,
    knowledge: KnowledgeBase,
) -> ConversationResult:
    result = ConversationResult(conv)
    if conv.live_only and isinstance(llm.inner, FakeLLM):
        result.skipped = "mesurée avec le vrai modèle seulement (--live)"
        return result
    calendar = FakeCalendar()  # le même agenda d'un tour à l'autre : créneaux proposés puis choisis
    said: list[str] = []
    try:
        async with session_factory() as session:
            ids = await runner.new_demo_prospect(
                session, db, label=LABEL, target_code=conv.target, profile=conv.profile
            )
            for index, turn in enumerate(conv.turns):
                r = await play_turn(
                    session, db, ids, conv.case(index), llm=llm, knowledge=knowledge,
                    calendar=calendar, said=said,
                )  # fmt: skip
                result.turns.append(r)
                result.seconds += r.seconds
                result.transcript.append(("prospect", turn.says))
                result.transcript += [("agent", m) for m in r.agent_messages]
                said += [turn.says, *r.agent_messages]
                if r.error or r.llm_unavailable:
                    break
                _measure(result, index, turn, r)
                result.final = r.observed
                if r.observed.get("conversation") != "open" and index < len(conv.turns) - 1:
                    result.stopped_early = True  # transfert ou clôture avant la fin prévue
                    break
    except Exception as exc:  # une erreur technique est un résultat, pas un plantage de l'outil
        result.error = f"{type(exc).__name__}: {exc}"
    return result


async def run_conversations(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    convs: list[Conversation],
    *,
    llm: LanguageModel,
    knowledge: KnowledgeBase | None = None,
    pause: float = 0.0,
    on_done: Callable[[ConversationResult], None] | None = None,
) -> list[ConversationResult]:
    metered = llm if isinstance(llm, MeteredLLM) else MeteredLLM(llm)
    kb = knowledge or LexicalKnowledge()
    results = []
    for i, conv in enumerate(convs):
        if i and pause:
            await asyncio.sleep(pause)  # quota des formules gratuites
        start = time.perf_counter()
        r = await run_conversation(session_factory, db, conv, llm=metered, knowledge=kb)
        r.seconds = r.seconds or time.perf_counter() - start
        results.append(r)
        if on_done:
            on_done(r)
    return results


# --- Métriques ---


@dataclass
class ConversationSummary:
    conversations: int
    played: int
    evaluable: int
    skipped: int
    errors: int
    llm_unavailable: int
    conform: Rate
    turns: Rate
    context: Rate
    grounded: Rate
    end: Rate
    profile: Rate
    handoff_missed: int
    handoff_unneeded: int
    stopped_early: int
    agent_messages: int
    reasked: int
    greetings_repeated: int
    ai_self_intros: int
    multi_questions: int
    sent_with_claims: int
    latency_median: float | None
    llm_calls: int
    tokens_in: int
    tokens_out: int
    # Qualification et technique de vente : indicateurs, hors conformité.
    meeting_on_time: Rate
    question_kinds: dict[str, int]
    reformulations: int
    words_median: float | None
    long_messages: int
    advisor_offers: int
    repeated_offers: int
    eligibility_verdicts: int
    template_greetings: int

    def as_dict(self) -> dict[str, Any]:
        def rate(r: Rate) -> dict[str, Any]:
            return {"ok": r.ok, "total": r.total, "rate": r.value}

        return {
            "conversations": self.conversations,
            "played": self.played,
            "evaluable": self.evaluable,
            "skipped": self.skipped,
            "errors": self.errors,
            "llm_unavailable": self.llm_unavailable,
            "conform": rate(self.conform),
            "turns_conform": rate(self.turns),
            "context_followed": rate(self.context),
            "grounded_answers": rate(self.grounded),
            "journey_end": rate(self.end),
            "profile_read": rate(self.profile),
            "handoff": {"missed": self.handoff_missed, "unneeded": self.handoff_unneeded},
            "stopped_early": self.stopped_early,
            "agent_messages": self.agent_messages,
            "reasked": self.reasked,
            "greetings_repeated": self.greetings_repeated,
            "ai_self_intros": self.ai_self_intros,
            "multi_questions": self.multi_questions,
            "sent_with_ungrounded_claims": self.sent_with_claims,
            "latency_seconds_median": self.latency_median,
            "llm_calls": self.llm_calls,
            "tokens_estimated": {"input": self.tokens_in, "output": self.tokens_out},
            "sales_indicators": {
                "meeting_proposed_on_time": rate(self.meeting_on_time),
                "question_kinds": self.question_kinds,
                "reformulations": self.reformulations,
                "words_median": self.words_median,
                "long_messages": self.long_messages,
                "advisor_offers": self.advisor_offers,
                "repeated_advisor_offers": self.repeated_offers,
                "eligibility_verdicts": self.eligibility_verdicts,
                "template_greetings": self.template_greetings,
            },
        }


def summarize(results: list[ConversationResult]) -> ConversationSummary:
    """Métriques sur les conversations ÉVALUABLES : une panne du modèle ou une erreur technique est
    comptée à part, une conversation `live_only` ignorée hors ligne aussi."""
    ev = [r for r in results if r.evaluable]
    turns = [(r.conversation.turns[i], t) for r in ev for i, t in enumerate(r.turns)]
    calls = [c for r in results for t in r.turns for c in t.calls]
    latencies = [r.seconds for r in ev]
    words = [w for r in ev for w in r.words]
    played = [r for r in results if r.skipped is None]
    return ConversationSummary(
        conversations=len(results),
        played=len(played),
        evaluable=len(ev),
        skipped=len(results) - len(played),
        errors=sum(1 for r in played if r.error or any(t.error for t in r.turns)),
        llm_unavailable=sum(1 for r in played if r.error is None and r.llm_unavailable),
        conform=_rate([r.ok for r in ev]),
        turns=_rate([t.ok for _, t in turns]),
        context=_rate([t.ok for turn, t in turns if turn.context]),
        grounded=_rate([t.grounded_ok for _, t in turns]),
        end=_rate([r.end_ok for r in ev]),
        profile=_rate([c for r in ev for c in r.profile_checks]),
        handoff_missed=sum(1 for _, t in turns if t.case.handoff and not t.handed_off),
        handoff_unneeded=sum(1 for _, t in turns if t.case.handoff is False and t.handed_off),
        stopped_early=sum(1 for r in ev if r.stopped_early),
        agent_messages=sum(r.agent_messages for r in ev),
        reasked=sum(len(r.reasked) for r in ev),
        greetings_repeated=sum(r.greetings_repeated for r in ev),
        ai_self_intros=sum(r.ai_self_intros for r in ev),
        multi_questions=sum(r.multi_questions for r in ev),
        sent_with_claims=sum(1 for _, t in turns for c in t.sent_claims_by_message if c),
        latency_median=statistics.median(latencies) if latencies else None,
        llm_calls=len(calls),
        tokens_in=sum(c.chars_in for c in calls) // CHARS_PER_TOKEN,
        tokens_out=sum(c.chars_out for c in calls) // CHARS_PER_TOKEN,
        meeting_on_time=_rate([r.meeting_on_time for r in ev]),
        question_kinds={
            kind: sum(r.question_kinds.count(kind) for r in ev)
            for kind in ("exploration", "information", "alternative", "fermée")
        },
        reformulations=sum(r.reformulations for r in ev),
        words_median=statistics.median(words) if words else None,
        long_messages=sum(1 for w in words if w > LONG_MESSAGE_WORDS),
        advisor_offers=sum(r.advisor_offers for r in ev),
        repeated_offers=sum(r.repeated_offers for r in ev),
        eligibility_verdicts=sum(r.eligibility_verdicts for r in ev),
        template_greetings=sum(r.template_greetings for r in ev),
    )


# --- Rapports ---


def _issues(r: ConversationResult) -> list[str]:
    issues = []
    for t in r.turns:
        issues += [f"{t.case.id} : {g}" for g in _gaps(t)]
    if r.stopped_early:
        issues.append(
            f"arrêtée au tour {len(r.turns)} sur {len(r.conversation.turns)} "
            f"(conversation {r.final.get('conversation')})"
        )
    for i, ok in enumerate(r.profile_checks):
        if ok is False:
            expected = r.conversation.turns[i].profile_after
            got = r.turns[i].observed.get("profile") or {}
            issues.append(f"tour {i + 1} : profil lu {got} (attendu : {expected})")
    issues += [f"information redemandée ({x})" for x in r.reasked]
    if r.greetings_repeated:
        issues.append(f"salutation répétée : {r.greetings_repeated} message(s)")
    if r.ai_self_intros:
        issues.append(f"se présente comme une IA sans qu'on le demande : {r.ai_self_intros} fois")
    if r.multi_questions:
        issues.append(f"plus d'une question par message : {r.multi_questions} message(s)")
    if r.end_ok is False:
        issues.append(f"état final {r.final} (attendu : {r.conversation.end})")
    return issues


def _kinds(kinds: dict[str, int]) -> str:
    total = sum(kinds.values())
    if not total:
        return "aucune"
    return " ; ".join(f"{k} {v}" for k, v in kinds.items())


def _words(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.0f} mots"


def format_console(r: ConversationResult) -> str:
    cid = r.conversation.id
    if r.skipped:
        return f"  -  {cid:<28} ignorée : {r.skipped}"
    if r.error:
        return f"  !  {cid:<28} erreur : {r.error}"
    if r.llm_unavailable:
        return f"  ~  {cid:<28} modèle indisponible (non comptée)"
    marks = " ".join("✓" if t.ok else "✗" for t in r.turns)
    line = (
        f" {'OK' if r.ok else 'KO'}  {cid:<28} tours {marks}  fin {_mark(r.end_ok)}  "
        f"profil {_mark(r.profile_ok)}  ton {_mark(r.style_ok)}  {r.seconds:.1f} s"
    )
    issues = _issues(r)
    if issues and not r.ok:
        line += "".join(f"\n        {i}" for i in issues[:4])
    return line


def format_markdown(
    results: list[ConversationResult], summary: ConversationSummary, *, mode: str, model: str,
    knowledge: str,
) -> str:  # fmt: skip
    s = summary
    out = [
        "# Évaluation de conversations",
        "",
        f"- Date : {datetime.now(UTC):%Y-%m-%d %H:%M} UTC",
        f"- Mode : **{mode}** — modèle : `{model}`",
        f"- Base de connaissances : {knowledge}",
        f"- Conversations : {s.conversations} ; jouées : {s.played} ; évaluables : {s.evaluable} ; "
        f"ignorées : {s.skipped} ; modèle indisponible : {s.llm_unavailable} ; erreurs : {s.errors}",
        "",
        "## Synthèse",
        "",
        "| Mesure | Valeur | Lecture |",
        "|---|---|---|",
        f"| Conversations conformes | {s.conform} | tous les tours justes, ton tenu, bon état final |",
        f"| Tours conformes | {s.turns} | mêmes vérifications que `eval-agent`, tour par tour |",
        f"| Contexte suivi | {s.context} | questions de suivi (« et ça dure combien ? ») justes |",
        f"| Réponses sourcées | {s.grounded} | la réponse contient le fait attendu de la base |",
        f"| Parcours menés au bout | {s.end} | état final attendu (rendez-vous, arrêt, transfert…) |",
        f"| Profil lu juste | {s.profile} | informations de qualification extraites du message |",
        f"| Transferts | manqués : {s.handoff_missed} ; inutiles : {s.handoff_unneeded} | "
        f"conversations arrêtées avant la fin prévue : {s.stopped_early} |",
        f"| Informations redemandées | {s.reasked} | sur {s.agent_messages} messages de l'agent |",
        f"| Salutations répétées | {s.greetings_repeated} | « Bonjour » après le premier message |",
        f"| Présentation comme IA non demandée | {s.ai_self_intros} | objectif : 0 (D-32) |",
        f"| Messages à plusieurs questions | {s.multi_questions} | une seule question par message |",
        f"| Messages avec chiffre non sourcé | {s.sent_with_claims} | APRÈS garde-fous (objectif : 0) |",
        f"| Durée par conversation | médiane {_fmt_seconds(s.latency_median)} | workflow complet |",
        f"| Appels au modèle | {s.llm_calls} | jetons estimés : entrée {s.tokens_in}, "
        f"sortie {s.tokens_out} |",
        "",
        "## Qualification et technique de vente (indicateurs)",
        "",
        "Hors conformité : ils décrivent la façon de prospecter, à comparer d'un passage à l'autre.",
        "",
        "| Indicateur | Valeur | Lecture |",
        "|---|---|---|",
        f"| Rendez-vous proposé à temps | {s.meeting_on_time} | l'agent le propose de lui-même au "
        "plus tard au tour prévu (`meeting_by`) |",
        f"| Questions posées | {_kinds(s.question_kinds)} | exploration (projet, motivation), "
        "information (un fait), alternative (X ou Y), fermée (oui/non) |",
        f"| Reformulations | {s.reformulations}/{s.agent_messages} messages | l'agent reprend ce "
        "que le prospect vient de dire (écoute active) |",
        f"| Longueur des messages | médiane {_words(s.words_median)} ; au-delà de "
        f"{LONG_MESSAGE_WORDS} mots : {s.long_messages} | consigne : {LONG_MESSAGE_WORDS} mots au plus |",
        f"| Offres de conseiller | {s.advisor_offers} ; répétées : {s.repeated_offers} | « voulez-vous "
        "un conseiller ? » posé par le modèle (D-33 : jamais de lui-même) |",
        f"| Avis d'admission donnés | {s.eligibility_verdicts} | « votre profil correspond aux "
        "conditions » : l'admission revient à l'école |",
        f"| Salutations dans les messages fixes | {s.template_greetings} | « Bonjour » en tête des "
        "créneaux ou de la confirmation, en pleine conversation |",
        "",
        "## Conversations",
        "",
        "| Conversation | Tours | Fin | Profil | Ton | Durée |",
        "|---|---|---|---|---|---|",
    ]
    for r in results:
        cid = r.conversation.id
        if r.skipped or r.error or r.llm_unavailable:
            why = r.skipped or ("erreur" if r.error else "modèle indisponible")
            out.append(f"| {cid} | {why} | | | | |")
            continue
        marks = " ".join("✓" if t.ok else "✗" for t in r.turns)
        out.append(
            f"| {cid} | {marks} | {_mark(r.end_ok)} | {_mark(r.profile_ok)} | "
            f"{_mark(r.style_ok)} | {r.seconds:.1f} s |"
        )
    out += ["", "## Détail et échanges", ""]
    for r in results:
        if r.skipped:
            continue
        status = "conforme" if r.ok else "écarts"
        out += [f"### {r.conversation.id} : {status}", "", f"*{r.conversation.title}*", ""]
        if r.error:
            out += [f"- Erreur technique : {r.error}", ""]
            continue
        issues = _issues(r)
        if issues:
            out += [f"- {i}" for i in issues] + [""]
        for role, text in r.transcript:
            who = "Prospect" if role == "prospect" else "Agent"
            out.append(f"> **{who}** : {text.replace(chr(10), ' ')}")
            out.append(">")
        out.append("")
    out += [
        "## Méthode et limites",
        "",
        "- Une conversation = un prospect fictif neuf et plusieurs messages à la suite ; le vrai"
        " workflow décide à chaque tour, rien n'est envoyé.",
        "- Hors ligne, le faux modèle rejoue l'annotation : le résultat vérifie l'outil et les"
        " règles, pas le modèle. Les conversations de suivi du contexte ne sont jouées qu'avec"
        " `--live`.",
        "- Les messages du prospect sont écrits d'avance : si l'agent répond de façon inattendue, la"
        " suite peut ne plus coller ; c'est le prix d'une mesure comparable d'un passage à l'autre.",
        "- Informations redemandées, salutations et présentation comme IA sont repérées par des"
        " expressions courantes : un écart signalé se relit dans les échanges ci-dessus.",
        "- Les indicateurs de technique de vente (types de questions, reformulations, offres"
        " répétées, avis d'admission) sont repérés de la même façon : ils servent à comparer deux"
        " passages, pas à juger un message isolé.",
    ]
    return "\n".join(out) + "\n"


def to_json(results: list[ConversationResult], summary: ConversationSummary, **meta: Any) -> str:
    rows = [
        {
            "id": r.conversation.id,
            "ok": r.ok,
            "evaluable": r.evaluable,
            "skipped": r.skipped,
            "error": r.error,
            "end_ok": r.end_ok,
            "style_ok": r.style_ok,
            "stopped_early": r.stopped_early,
            "reasked": r.reasked,
            "greetings_repeated": r.greetings_repeated,
            "ai_self_intros": r.ai_self_intros,
            "multi_questions": r.multi_questions,
            "profile_ok": r.profile_ok,
            "meeting_turn": r.meeting_turn,
            "meeting_on_time": r.meeting_on_time,
            "question_kinds": r.question_kinds,
            "reformulations": r.reformulations,
            "words": r.words,
            "repeated_advisor_offers": r.repeated_offers,
            "eligibility_verdicts": r.eligibility_verdicts,
            "template_greetings": r.template_greetings,
            "final": {k: v for k, v in r.final.items() if k != "profile"},
            "seconds": round(r.seconds, 3),
            "turns": [
                {
                    "id": t.case.id,
                    "ok": t.ok,
                    "intent": t.intent,
                    "action": t.action,
                    "handoff_reason": t.handoff_reason,
                    "grounded_ok": t.grounded_ok,
                    "sent_claims": t.sent_claims,
                    "reply": t.reply_text,
                }
                for t in r.turns
            ],
        }
        for r in results
    ]
    payload = {"meta": meta, "summary": summary.as_dict(), "conversations": rows}
    return json.dumps(payload, ensure_ascii=False, indent=2)
