import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareValues, evaluationHref, readEvaluationView, type Indicator } from "@/lib/evaluation";
import { returnPath } from "@/lib/session/returnPath";

const query = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");
const RUN = "a".repeat(32);

const ind = (value: number | null, better: Indicator["better"], kind: Indicator["kind"] = "number"): Indicator => ({
  key: "k",
  label: "K",
  group: "G",
  value,
  display: String(value),
  better,
  kind,
});

describe("Évaluation", () => {
  test("adresse : aller-retour, valeurs inconnues ignorées (règle 6)", () => {
    const href = `/evaluation?tab=compare&suite=conversations&a=${RUN}&b=${"b".repeat(32)}`;
    assert.equal(evaluationHref(readEvaluationView(query(href))), href);
    assert.deepEqual(readEvaluationView(query("/evaluation?tab=supprimer&suite=x&a=1&indicator=DROP TABLE")), {
      tab: "history",
      suite: "",
      a: null,
      b: null,
      indicator: null,
    });
    assert.equal(evaluationHref(readEvaluationView(query("/evaluation"))), "/evaluation");
  });

  test("écart lu selon le sens du progrès", () => {
    assert.deepEqual(compareValues(ind(5, "down"), ind(0, "down")), { change: "better", delta: "−5" });
    assert.deepEqual(compareValues(ind(0.8, "up", "rate"), ind(0.7, "up", "rate")), { change: "worse", delta: "−10 pts" });
    assert.deepEqual(compareValues(ind(3, null), ind(4, null)), { change: "neutral", delta: "+1" });
    assert.equal(compareValues(ind(2, "up"), ind(2, "up")).change, "same");
    assert.equal(compareValues(ind(null, "up"), ind(2, "up")).change, "unknown"); // rapport plus ancien : n/a
  });

  test("retour après connexion : la page et un passage, rien d'autre", () => {
    assert.equal(returnPath("/evaluation?tab=evolution"), "/evaluation?tab=evolution");
    assert.equal(returnPath(`/evaluation/${RUN}`), `/evaluation/${RUN}`);
    assert.equal(returnPath("/evaluation/../team"), null);
    assert.equal(returnPath("/evaluation/123"), null);
  });
});
