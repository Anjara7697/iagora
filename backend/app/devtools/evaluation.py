"""Évaluation quantitative de l'agent (`python -m app.cli eval-agent`).

Les scénarios de recette (`scenarios.py`) vérifient qu'un cas précis se comporte comme prévu ; ce
module MESURE l'agent sur un jeu de cas annotés (`eval_cases.json`) et produit des métriques :
exactitude de l'intention lue par le modèle, exactitude de la décision, transferts justes, inutiles
ou manqués, réponses sourcées, chiffres non sourcés (avant et après les garde-fous), latence,
volume de texte échangé avec le modèle.

Chaque cas est joué sur un prospect FICTIF neuf (`eval.*@demo.example.com`), avec le vrai workflow
(`run_agent`), un agenda de démonstration et une base de connaissances FICTIVE (`demo_kb/`).
Rien n'est envoyé au prospect. Hors ligne (par défaut), le faux modèle rejoue l'annotation : le
résultat valide l'outil et les règles du workflow, PAS le modèle. Avec `--live`, le vrai modèle
configuré est mesuré.

Variantes d'ablation (recette uniquement) : `sans-rag` (aucun extrait de connaissance) et
`sans-garde-chiffres` (la vérification des chiffres non sourcés est désactivée pendant le cas).
"""

import asyncio
import json
import re
import statistics
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest import mock

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agents.defaults import EmptyKnowledgeBase
from app.agents.runtime import run_agent
from app.devtools import runner
from app.devtools.fakes import FakeCalendar, FakeLLM, _tokens
from app.graph import policy, prompts
from app.graph.ports import ChatMessage, KnowledgeBase, LanguageModel, Passage, T
from app.graph.state import Qualification
from app.models.enums import SenderType
from app.schemas.conversation import MessageCreate
from app.services import conversations
from app.services.agent_settings import AgentMode

CASES_FILE = Path(__file__).parent / "eval_cases.json"
DEMO_KB_DIR = Path(__file__).parent / "demo_kb"
EVAL_LABEL = "eval"  # préfixe des adresses fictives : eval.<jeton>@demo.example.com
ABLATIONS = ("sans-rag", "sans-garde-chiffres")
CHARS_PER_TOKEN = 4  # estimation usuelle ; le port du modèle ne remonte pas l'usage réel

# Référence capturée à l'import : l'ablation `sans-garde-chiffres` remplace la fonction du module
# `policy` pendant un cas, mais la MESURE doit toujours utiliser la vraie vérification.
_ungrounded_claims = policy.ungrounded_claims


# --- Jeu de cas ---


@dataclass
class EvalCase:
    id: str
    category: str
    message: str | None  # None : premier contact, l'agent écrit en premier
    target: str = "ebihar_students"
    intents: list[str] = field(default_factory=list)  # intentions acceptables
    actions: list[str] = field(default_factory=list)  # décisions acceptables
    handoff: bool | None = None  # None : transfert ou non, les deux sont acceptables
    handoff_reasons: list[str] = field(default_factory=list)
    must_mention: list[str] = field(default_factory=list)  # « a|b » : l'un ou l'autre
    profile: dict[str, str] = field(default_factory=dict)
    fake: dict[str, Any] = field(default_factory=dict)  # comportement du faux modèle


def load_cases(
    ids: Sequence[str] | None = None,
    categories: Sequence[str] | None = None,
    path: Path = CASES_FILE,
) -> list[EvalCase]:
    data = json.loads(path.read_text(encoding="utf-8"))
    cases = [EvalCase(**raw) for raw in data["cases"]]
    if ids:
        by_id = {c.id: c for c in cases}
        unknown = [i for i in ids if i not in by_id]
        if unknown:
            raise KeyError(f"Cas inconnu(s) : {unknown}. Disponibles : {sorted(by_id)}")
        cases = [by_id[i] for i in ids]
    if categories:
        cases = [c for c in cases if c.category in categories]
    return cases


# --- Base de connaissances FICTIVE (demo_kb/) ---


@dataclass
class _Entry:
    passage: Passage
    target: str | None
    tokens: set[str]


def _demo_corpus() -> list[_Entry]:
    entries = []
    for file in sorted(DEMO_KB_DIR.glob("*.md")):
        text = file.read_text(encoding="utf-8")
        meta: dict[str, str] = {}
        if text.startswith("---"):
            _, header, text = text.split("---", 2)
            for line in header.strip().splitlines():
                key, _, value = line.partition(":")
                meta[key.strip()] = value.strip()
        title = meta.get("title", file.stem)
        for block in re.split(r"^## ", text, flags=re.M)[1:]:
            heading, _, body = block.partition("\n")
            body = body.strip()
            entries.append(
                _Entry(
                    Passage(source=f"{title} / {heading.strip()} (FICTIF)", text=body),
                    meta.get("target"),
                    _tokens(f"{title} {heading} {body}"),
                )
            )
    return entries


class LexicalKnowledge:
    """Recherche lexicale sur la base de démonstration, déterministe et sans clé : classe les
    extraits par mots significatifs en commun avec la question, filtre par programme comme la vraie
    base, et écarte ce qui ne partage qu'un mot avec une question longue (seuil de pertinence)."""

    def __init__(self, entries: list[_Entry] | None = None) -> None:
        self.entries = _demo_corpus() if entries is None else entries

    async def search(self, query: str, target_code: str | None, limit: int = 4) -> list[Passage]:
        wanted = _tokens(query)
        if not wanted:
            return []
        need = min(2, len(wanted))
        scored = []
        for i, e in enumerate(self.entries):
            if e.target not in (None, target_code):
                continue
            common = len(wanted & e.tokens)
            if common >= need:
                scored.append((-common, i, e))
        scored.sort(key=lambda s: (s[0], s[1]))
        return [
            Passage(e.passage.source, e.passage.text, score=-neg / len(wanted))
            for neg, _, e in scored[:limit]
        ]


class RecordingKnowledge:
    """Enveloppe une base de connaissances et garde les extraits renvoyés (sources du cas)."""

    def __init__(self, inner: KnowledgeBase) -> None:
        self.inner = inner
        self.returned: list[Passage] = []

    async def search(self, query: str, target_code: str | None, limit: int = 4) -> list[Passage]:
        found = await self.inner.search(query, target_code, limit)
        self.returned.extend(found)
        return found


# --- Modèle instrumenté ---


@dataclass
class LLMCall:
    kind: str  # extract / generate
    seconds: float
    chars_in: int
    chars_out: int
    ok: bool


class MeteredLLM:
    """Enveloppe un modèle de langage : mesure chaque appel (durée, volume) et garde le texte brut
    rédigé, AVANT les garde-fous du workflow (qui peuvent le refuser)."""

    def __init__(self, inner: LanguageModel) -> None:
        self.inner = inner
        self.calls: list[LLMCall] = []
        self.raw_replies: list[str] = []

    @property
    def provider(self) -> str:
        return self.inner.provider

    @property
    def model(self) -> str:
        return self.inner.model

    def reset(self) -> None:
        self.calls, self.raw_replies = [], []

    @staticmethod
    def _size(system: str, messages: Sequence[ChatMessage]) -> int:
        return len(system) + sum(len(m.content) for m in messages)

    async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
        start = time.perf_counter()
        try:
            text = await self.inner.generate(system, messages)
        except Exception:
            self.calls.append(
                LLMCall(
                    "generate", time.perf_counter() - start, self._size(system, messages), 0, False
                )
            )
            raise
        self.calls.append(
            LLMCall(
                "generate",
                time.perf_counter() - start,
                self._size(system, messages),
                len(text),
                True,
            )
        )
        self.raw_replies.append(text)
        return text

    async def extract(self, system: str, messages: Sequence[ChatMessage], schema: type[T]) -> T:
        start = time.perf_counter()
        try:
            out = await self.inner.extract(system, messages, schema)
        except Exception:
            self.calls.append(
                LLMCall(
                    "extract", time.perf_counter() - start, self._size(system, messages), 0, False
                )
            )
            raise
        size_out = len(out.model_dump_json()) if hasattr(out, "model_dump_json") else 0
        self.calls.append(
            LLMCall(
                "extract", time.perf_counter() - start, self._size(system, messages), size_out, True
            )
        )
        return out


# --- Exécution ---


@dataclass
class CaseResult:
    case: EvalCase
    intent: str | None = None
    action: str = ""
    reason: str = ""
    handoff_reason: str | None = None
    handed_off: bool = False
    reply_text: str = ""  # messages de l'agent après le dernier message du prospect
    llm_written: list[str] = field(default_factory=list)  # parmi eux, ceux rédigés par le modèle
    raw_claims: list[list[str]] = field(default_factory=list)  # par sortie brute du modèle
    sent_claims_by_message: list[list[str]] = field(default_factory=list)  # par message envoyé
    seconds: float = 0.0
    calls: list[LLMCall] = field(default_factory=list)
    llm_unavailable: bool = False
    error: str | None = None

    # Chaque vérification vaut True/False, ou None quand elle ne s'applique pas au cas.
    @property
    def intent_ok(self) -> bool | None:
        if not self.case.intents or self.intent is None:
            return None
        return self.intent in self.case.intents

    @property
    def action_ok(self) -> bool | None:
        return self.action in self.case.actions if self.case.actions else None

    @property
    def handoff_ok(self) -> bool | None:
        if self.case.handoff is None:
            return None
        if self.handed_off != self.case.handoff:
            return False
        if self.handed_off and self.case.handoff_reasons:
            return self.handoff_reason in self.case.handoff_reasons
        return True

    @property
    def grounded_ok(self) -> bool | None:
        if not self.case.must_mention:
            return None
        text = re.sub(r"\s+", " ", policy.normalize(" ".join(self.llm_written)))
        return not self.handed_off and all(
            any(policy.normalize(alt).strip() in text for alt in item.split("|"))
            for item in self.case.must_mention
        )

    @property
    def sent_claims(self) -> list[str]:
        return [c for claims in self.sent_claims_by_message for c in claims]

    @property
    def evaluable(self) -> bool:
        return self.error is None and not self.llm_unavailable

    @property
    def ok(self) -> bool:
        checks = [self.intent_ok, self.action_ok, self.handoff_ok, self.grounded_ok]
        return self.evaluable and not self.sent_claims and all(c is not False for c in checks)


@contextmanager
def _ablation(name: str | None) -> Iterator[None]:
    if name == "sans-garde-chiffres":
        with mock.patch.object(policy, "ungrounded_claims", lambda reply, sources, **_: []):
            yield
    else:
        yield


def _intent_from_trace(trace: Sequence[Any]) -> str | None:
    for t in trace:
        if t.node != "qualify_prospect":
            continue
        if "demande d'arrêt détectée" in t.summary:
            return "opt_out"
        m = re.search(r"intention (\w+)", t.summary)
        return m.group(1) if m else None
    return None


def _configure_fake(fake: FakeLLM, case: EvalCase) -> None:
    q = case.fake.get("qualification")
    fake.qualification = Qualification(**q) if q else Qualification(intent="other")
    fake.reply = case.fake.get("reply") or "Bonjour, merci pour votre message."


async def run_case(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    case: EvalCase,
    *,
    llm: MeteredLLM,
    knowledge: KnowledgeBase,
    ablation: str | None = None,
) -> CaseResult:
    result = CaseResult(case)
    if isinstance(llm.inner, FakeLLM):
        _configure_fake(llm.inner, case)
    llm.reset()
    kb = RecordingKnowledge(EmptyKnowledgeBase() if ablation == "sans-rag" else knowledge)
    try:
        async with session_factory() as session:
            pid, mid, cid = await runner.new_demo_prospect(
                session, db, label=EVAL_LABEL, target_code=case.target, profile=case.profile
            )
            if case.message is not None:
                await conversations.add_message(
                    session, db, cid, MessageCreate(role=SenderType.PROSPECT, content=case.message)
                )
            start = time.perf_counter()
            with _ablation(ablation):
                run = await run_agent(
                    session,
                    db,
                    llm=llm,
                    calendar=FakeCalendar(),  # agenda de démonstration : aucun vrai rendez-vous
                    knowledge=kb,
                    conversation_id=cid,
                    mode=AgentMode.AUTO,
                )
            result.seconds = time.perf_counter() - start
            observed, tail, llm_written = await runner.observe(session, db, pid, mid, cid)
    except Exception as exc:  # une erreur technique est un résultat, pas un plantage de l'outil
        result.error = f"{type(exc).__name__}: {exc}"
        result.calls = list(llm.calls)
        return result

    result.intent = _intent_from_trace(run.trace)
    result.action, result.reason = run.action, run.reason
    result.handoff_reason = run.handoff_reason
    result.handed_off = run.handoff_reason is not None or observed["conversation"] == "handed_off"
    result.reply_text = "\n".join(reversed(tail))
    result.llm_written = list(reversed(llm_written))
    result.calls = list(llm.calls)
    result.llm_unavailable = run.handoff_reason == "llm_indisponible" or any(
        not c.ok for c in llm.calls
    )
    # NF-10 : sources validées = extraits renvoyés, catalogue, campagne ; le message du prospect ne
    # justifie que les durées, dates et niveaux, jamais un prix ni une condition (AUDIT-AI-001).
    sources = [p.text for p in kb.returned] + [prompts.CATALOGUE, runner.SCENARIO_CAMPAIGN]
    said = [case.message or ""]
    result.raw_claims = [_ungrounded_claims(r, sources, conversation=said) for r in llm.raw_replies]
    result.sent_claims_by_message = [
        _ungrounded_claims(t, sources, conversation=said) for t in result.llm_written
    ]
    return result


async def run_eval(
    session_factory: async_sessionmaker[AsyncSession],
    db: Any,
    cases: list[EvalCase],
    *,
    llm: LanguageModel,
    knowledge: KnowledgeBase | None = None,
    ablation: str | None = None,
    pause: float = 0.0,
    on_done: Callable[[CaseResult], None] | None = None,
) -> list[CaseResult]:
    if ablation is not None and ablation not in ABLATIONS:
        raise ValueError(f"Variante inconnue : {ablation}. Disponibles : {ABLATIONS}")
    metered = llm if isinstance(llm, MeteredLLM) else MeteredLLM(llm)
    kb = knowledge or LexicalKnowledge()
    results = []
    for i, case in enumerate(cases):
        if i and pause:
            await asyncio.sleep(pause)  # quota des formules gratuites
        r = await run_case(session_factory, db, case, llm=metered, knowledge=kb, ablation=ablation)
        results.append(r)
        if on_done:
            on_done(r)
    return results


# --- Métriques ---


@dataclass
class Rate:
    ok: int
    total: int

    @property
    def value(self) -> float | None:
        return self.ok / self.total if self.total else None

    def __str__(self) -> str:
        if not self.total:
            return "n/a"
        return f"{self.ok}/{self.total} ({100 * self.ok / self.total:.0f} %)"


def _rate(values: Sequence[bool | None]) -> Rate:
    applicable = [v for v in values if v is not None]
    return Rate(sum(applicable), len(applicable))


def _percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


@dataclass
class Summary:
    cases: int
    evaluable: int
    errors: int
    llm_unavailable: int
    conform: Rate
    intent: Rate
    decision: Rate
    handoff: Rate
    handoff_expected: int
    handoff_correct: int
    handoff_missed: int
    handoff_unneeded: int
    grounded: Rate
    raw_outputs: int
    raw_with_claims: int
    sent_messages: int
    sent_with_claims: int
    latency_median: float | None
    latency_p90: float | None
    latency_max: float | None
    llm_calls: int
    tokens_in: int
    tokens_out: int
    cost: float | None
    by_category: dict[str, Rate]

    @property
    def raw_hallucination(self) -> Rate:
        return Rate(self.raw_with_claims, self.raw_outputs)

    @property
    def sent_hallucination(self) -> Rate:
        return Rate(self.sent_with_claims, self.sent_messages)

    def as_dict(self) -> dict[str, Any]:
        def rate(r: Rate) -> dict[str, Any]:
            return {"ok": r.ok, "total": r.total, "rate": r.value}

        return {
            "cases": self.cases,
            "evaluable": self.evaluable,
            "errors": self.errors,
            "llm_unavailable": self.llm_unavailable,
            "conform": rate(self.conform),
            "intent_accuracy": rate(self.intent),
            "decision_accuracy": rate(self.decision),
            "handoff_accuracy": rate(self.handoff),
            "handoff": {
                "expected": self.handoff_expected,
                "correct": self.handoff_correct,
                "missed": self.handoff_missed,
                "unneeded": self.handoff_unneeded,
            },
            "grounded_answers": rate(self.grounded),
            "ungrounded_raw": rate(self.raw_hallucination),
            "ungrounded_sent": rate(self.sent_hallucination),
            "latency_seconds": {
                "median": self.latency_median,
                "p90": self.latency_p90,
                "max": self.latency_max,
            },
            "llm_calls": self.llm_calls,
            "tokens_estimated": {"input": self.tokens_in, "output": self.tokens_out},
            "cost_estimated": self.cost,
            "by_category": {k: rate(v) for k, v in self.by_category.items()},
        }


def summarize(
    results: list[CaseResult],
    *,
    price_in: float | None = None,
    price_out: float | None = None,
) -> Summary:
    """Métriques calculées sur les cas ÉVALUABLES (ni erreur technique, ni modèle indisponible) ;
    ces derniers sont comptés à part pour ne pas confondre une panne de quota avec une erreur de
    jugement. Prix : par million de jetons, uniquement s'ils sont fournis (aucun tarif supposé)."""
    ev = [r for r in results if r.evaluable]
    with_handoff = [r for r in ev if r.case.handoff is not None]
    raw = [claims for r in ev for claims in r.raw_claims]
    sent = [claims for r in ev for claims in r.sent_claims_by_message]
    latencies = [r.seconds for r in ev]
    calls = [c for r in results for c in r.calls]
    tokens_in = sum(c.chars_in for c in calls) // CHARS_PER_TOKEN
    tokens_out = sum(c.chars_out for c in calls) // CHARS_PER_TOKEN
    cost = None
    if price_in is not None and price_out is not None:
        cost = tokens_in / 1e6 * price_in + tokens_out / 1e6 * price_out
    categories: dict[str, list[CaseResult]] = {}
    for r in ev:
        categories.setdefault(r.case.category, []).append(r)
    return Summary(
        cases=len(results),
        evaluable=len(ev),
        errors=sum(1 for r in results if r.error),
        llm_unavailable=sum(1 for r in results if r.error is None and r.llm_unavailable),
        conform=_rate([r.ok for r in ev]),
        intent=_rate([r.intent_ok for r in ev]),
        decision=_rate([r.action_ok for r in ev]),
        handoff=_rate([r.handoff_ok for r in ev]),
        handoff_expected=sum(1 for r in with_handoff if r.case.handoff),
        handoff_correct=sum(1 for r in with_handoff if r.case.handoff and r.handoff_ok),
        handoff_missed=sum(1 for r in with_handoff if r.case.handoff and not r.handed_off),
        handoff_unneeded=sum(1 for r in with_handoff if not r.case.handoff and r.handed_off),
        grounded=_rate([r.grounded_ok for r in ev]),
        raw_outputs=len(raw),
        raw_with_claims=sum(1 for c in raw if c),
        sent_messages=len(sent),
        sent_with_claims=sum(1 for c in sent if c),
        latency_median=statistics.median(latencies) if latencies else None,
        latency_p90=_percentile(latencies, 0.9) if latencies else None,
        latency_max=max(latencies) if latencies else None,
        llm_calls=len(calls),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost=cost,
        by_category={k: _rate([r.ok for r in v]) for k, v in sorted(categories.items())},
    )


# --- Rapports ---


def _mark(value: bool | None) -> str:
    return "-" if value is None else ("✓" if value else "✗")


def format_console(r: CaseResult) -> str:
    if r.error:
        return f"  !  {r.case.id:<28} erreur : {r.error}"
    if r.llm_unavailable:
        return f"  ~  {r.case.id:<28} modèle indisponible (non compté)"
    line = (
        f" {'OK' if r.ok else 'KO'}  {r.case.id:<28} intention {_mark(r.intent_ok)} "
        f"décision {_mark(r.action_ok)} transfert {_mark(r.handoff_ok)} "
        f"sourcé {_mark(r.grounded_ok)}  {r.seconds:.1f} s"
    )
    if r.sent_claims:
        line += f"\n        chiffres non sourcés envoyés : {r.sent_claims}"
    return line


def _fmt_seconds(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f} s"


def _gaps(r: CaseResult) -> list[str]:
    c = r.case
    gaps = []
    if r.intent_ok is False:
        gaps.append(f"intention `{r.intent}` (attendu : {', '.join(c.intents)})")
    if r.action_ok is False:
        gaps.append(f"décision `{r.action}` (attendu : {', '.join(c.actions)})")
    if r.handoff_ok is False:
        got = f"transfert `{r.handoff_reason}`" if r.handed_off else "aucun transfert"
        want = (
            "aucun transfert"
            if not c.handoff
            else f"transfert ({', '.join(c.handoff_reasons) or 'tout motif'})"
        )
        gaps.append(f"{got} (attendu : {want})")
    if r.grounded_ok is False:
        gaps.append(f"réponse sans « {' ; '.join(c.must_mention)} »")
    if r.sent_claims:
        gaps.append(f"chiffres non sourcés envoyés : {r.sent_claims}")
    return gaps


def format_markdown(
    results: list[CaseResult], summary: Summary, *, mode: str, model: str, ablation: str | None,
    knowledge: str,
) -> str:  # fmt: skip
    s = summary
    cost = "non calculé (prix non fournis)" if s.cost is None else f"{s.cost:.4f} (estimation)"
    out = [
        "# Évaluation de l'agent",
        "",
        f"- Date : {datetime.now(UTC):%Y-%m-%d %H:%M} UTC",
        f"- Mode : **{mode}** — modèle : `{model}`",
        f"- Variante : **{ablation or 'complète'}** — base de connaissances : {knowledge}",
        f"- Cas : {s.cases} ; évaluables : {s.evaluable} ; modèle indisponible : "
        f"{s.llm_unavailable} ; erreurs techniques : {s.errors}",
        "",
        "## Synthèse",
        "",
        "| Mesure | Valeur | Lecture |",
        "|---|---|---|",
        f"| Cas conformes | {s.conform} | toutes les vérifications applicables du cas sont justes |",
        f"| Intention lue | {s.intent} | intention du modèle parmi celles annotées |",
        f"| Décision | {s.decision} | action décidée parmi celles annotées |",
        f"| Transfert juste | {s.handoff} | transfert quand il faut (bon motif), aucun sinon |",
        f"| Transferts attendus réalisés | {s.handoff_correct}/{s.handoff_expected} | "
        f"manqués : {s.handoff_missed} ; inutiles : {s.handoff_unneeded} |",
        f"| Réponses sourcées | {s.grounded} | la réponse contient le fait attendu de la base |",
        f"| Sorties brutes avec chiffre non sourcé | {s.raw_hallucination} | "
        "texte du modèle AVANT les garde-fous |",
        f"| Messages envoyés avec chiffre non sourcé | {s.sent_hallucination} | "
        "APRÈS les garde-fous (objectif : 0) |",
        f"| Latence par cas | médiane {_fmt_seconds(s.latency_median)}, "
        f"p90 {_fmt_seconds(s.latency_p90)}, max {_fmt_seconds(s.latency_max)} | "
        "workflow complet, base de données comprise |",
        f"| Appels au modèle | {s.llm_calls} | qualification + rédaction (+ nouvel essai) |",
        f"| Jetons (estimation) | entrée {s.tokens_in}, sortie {s.tokens_out} | "
        f"≈ {CHARS_PER_TOKEN} caractères par jeton |",
        f"| Coût | {cost} | prix par million de jetons passés en option |",
        "",
        "## Par catégorie",
        "",
        "| Catégorie | Conformes |",
        "|---|---|",
    ]
    out += [f"| {k} | {v} |" for k, v in s.by_category.items()]
    out += [
        "",
        "## Détail des cas",
        "",
        "| Cas | Intention | Décision | Transfert | Sourcé | Durée |",
    ]
    out.append("|---|---|---|---|---|---|")
    for r in results:
        if r.error or r.llm_unavailable:
            why = "erreur" if r.error else "modèle indisponible"
            out.append(f"| {r.case.id} | {why} | | | | |")
            continue
        out.append(
            f"| {r.case.id} | {_mark(r.intent_ok)} `{r.intent or '-'}` | {_mark(r.action_ok)} "
            f"`{r.action}` | {_mark(r.handoff_ok)} `{r.handoff_reason or '-'}` | "
            f"{_mark(r.grounded_ok)} | {r.seconds:.1f} s |"
        )
    failing = [r for r in results if not r.ok]
    out += ["", "## Écarts", ""]
    if not failing:
        out.append("Aucun.")
    for r in failing:
        out.append(f"### {r.case.id} ({r.case.category})")
        out.append(f"- Prospect : « {r.case.message or '(premier contact)'} »")
        if r.error:
            out.append(f"- Erreur technique : {r.error}")
        elif r.llm_unavailable:
            out.append("- Modèle indisponible (quota, clé ou réseau) : cas non compté")
        else:
            out += [f"- {g}" for g in _gaps(r)]
            out.append(f"- Décision : `{r.action}` — {r.reason}")
            reply = r.reply_text.replace("\n", " ")
            out.append(f"- Réponse de l'agent : {('« ' + reply + ' »') if reply else '(aucune)'}")
        out.append("")
    out += [
        "## Méthode et limites",
        "",
        "- Un cas = un prospect fictif neuf et un message ; le vrai workflow décide, rien n'est envoyé.",
        "- Hors ligne, le faux modèle rejoue l'annotation : le résultat vérifie l'outil et les règles,"
        " pas le modèle. Seul `--live` mesure le modèle.",
        "- Chiffre non sourcé : prix, durée, pourcentage ou date absent des extraits renvoyés, du"
        " message du prospect et du catalogue validé (même règle que le workflow, NF-10).",
        "- Jetons estimés à partir du nombre de caractères ; coût calculé seulement si les prix sont"
        " fournis.",
        "- La base de connaissances par défaut est la base FICTIVE de démonstration, avec une"
        " recherche lexicale : la qualité de la recherche réelle se mesure à part (`kb-eval`).",
    ]
    return "\n".join(out) + "\n"


def to_json(results: list[CaseResult], summary: Summary, **meta: Any) -> str:
    rows = [
        {
            "id": r.case.id,
            "category": r.case.category,
            "ok": r.ok,
            "evaluable": r.evaluable,
            "intent": r.intent,
            "intent_ok": r.intent_ok,
            "action": r.action,
            "action_ok": r.action_ok,
            "handoff_reason": r.handoff_reason,
            "handed_off": r.handed_off,
            "handoff_ok": r.handoff_ok,
            "grounded_ok": r.grounded_ok,
            "raw_claims": r.raw_claims,
            "sent_claims": r.sent_claims,
            "seconds": round(r.seconds, 3),
            "llm_calls": len(r.calls),
            "error": r.error,
        }
        for r in results
    ]
    payload = {"meta": meta, "summary": summary.as_dict(), "cases": rows}
    return json.dumps(payload, ensure_ascii=False, indent=2)
