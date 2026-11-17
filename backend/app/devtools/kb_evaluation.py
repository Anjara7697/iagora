"""Évaluation de la recherche dans la base de connaissances (`python -m app.cli kb-eval`).

Pour chaque question type (`demo_kb/eval.json`), on regarde le premier extrait trouvé : son
document, son score, et s'il passe le seuil (`rag_min_score`). Trois sortes de questions :
- `expect` : le document qui doit répondre ; conforme s'il est retenu et que c'est le bon ;
- `expect` à null : hors sujet ; conforme si rien n'est retenu ;
- `same_topic` : même sujet, sans réponse dans les documents. Le seuil ne peut pas l'écarter :
  c'est l'agent qui le signale et transfère. Mesurée, jamais comptée en échec.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.integrations.knowledge.pg_knowledge import PgKnowledgeBase

CASES_FILE = Path(__file__).parent / "demo_kb" / "eval.json"


@dataclass(frozen=True)
class KbCase:
    question: str
    target: str
    expect: str | None
    same_topic: bool = False


@dataclass
class KbResult:
    case: KbCase
    slug: str | None
    score: float
    retained: bool

    @property
    def ok(self) -> bool | None:
        if self.case.same_topic:
            return None
        if self.case.expect is None:
            return not self.retained
        return self.retained and self.slug == self.case.expect


def load_cases() -> list[KbCase]:
    raw = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    return [
        KbCase(c["question"], c["target"], c.get("expect"), bool(c.get("same_topic"))) for c in raw
    ]


async def run(
    kb: PgKnowledgeBase,
    title_to_slug: dict[str, str],
    cases: list[KbCase],
    *,
    on_done: Callable[[KbResult], None] | None = None,
) -> list[KbResult]:
    results = []
    for case in cases:
        passages = await kb.search_all(case.question, case.target, 1)
        top = passages[0] if passages else None
        score = (top.score or 0.0) if top else 0.0
        slug = title_to_slug.get(top.source.split(" / ")[0]) if top else None
        r = KbResult(case, slug, score, top is not None and score >= kb.min_score)
        results.append(r)
        if on_done:
            on_done(r)
    return results


def summarize(results: list[KbResult], min_score: float) -> dict[str, Any]:
    measured = [r for r in results if r.ok is not None]
    hits = [r.score for r in measured if r.case.expect is not None]
    misses = [r.score for r in measured if r.case.expect is None]
    same = [r.score for r in results if r.case.same_topic]
    ok = sum(1 for r in measured if r.ok)
    return {
        "questions": len(results),
        "conform": {
            "ok": ok,
            "total": len(measured),
            "rate": ok / len(measured) if measured else None,
        },
        "min_score": min_score,
        "relevant_score_min": min(hits) if hits else None,
        "off_topic_score_max": max(misses) if misses else None,
        "same_topic_scores": [min(same), max(same)] if same else None,
        "same_topic_retained": sum(1 for r in results if r.case.same_topic and r.retained),
    }


def format_console(r: KbResult) -> str:
    target = r.slug or "—"
    if r.case.same_topic:
        note = " (retenu : l’agent doit transférer)" if r.retained else " (écarté)"
        return f"ℹ [{r.score:.3f}] {r.case.question}  → {target}{note}"
    return (
        f"{'✓' if r.ok else '✗'} [{r.score:.3f}] {r.case.question}  → {target}"
        f"{'' if r.retained else ' (écarté)'}"
    )


def to_payload(results: list[KbResult], summary: dict[str, Any], **meta: Any) -> dict[str, Any]:
    rows = [
        {
            "question": r.case.question,
            "target": r.case.target,
            "expect": r.case.expect,
            "same_topic": r.case.same_topic,
            "found": r.slug,
            "score": round(r.score, 4),
            "retained": r.retained,
            "ok": r.ok,
        }
        for r in results
    ]
    return {"meta": meta, "summary": summary, "questions": rows}
