"use client";

import { GitCompareArrows } from "lucide-react";
import { Field, SelectBox } from "@/components/ds/controls";
import { EmptyPanel } from "@/components/ds/layout";
import { SUITES, formatRunDate, type EvalRun, type EvaluationView } from "@/lib/evaluation";
import IndicatorTable, { compareSummary } from "./IndicatorTable";

/**
 * Comparer deux passages d'une même suite (avant / après une PR) : les passages choisis sont dans l'adresse
 * (`?tab=compare&a=…&b=…`). Par défaut, l'avant-dernier et le dernier passage terminés de la suite.
 */
export default function CompareView({
  runs,
  view,
  onChange,
}: {
  runs: EvalRun[];
  view: EvaluationView;
  onChange: (patch: Partial<EvaluationView>) => void;
}) {
  const usable = runs.filter((r) => r.indicators.length > 0);
  const byId = new Map(usable.map((r) => [r.id, r]));
  // `runs` arrive du plus récent au plus ancien.
  const suite = view.suite || (view.b && byId.get(view.b)?.suite) || (view.a && byId.get(view.a)?.suite) || usable[0]?.suite || "";
  const ofSuite = usable.filter((r) => r.suite === suite);
  const after = (view.b && byId.get(view.b)?.suite === suite ? byId.get(view.b) : undefined) ?? ofSuite[0];
  const before =
    (view.a && byId.get(view.a)?.suite === suite ? byId.get(view.a) : undefined) ?? ofSuite.find((r) => r.id !== after?.id);

  if (ofSuite.length < 2 || !before || !after) {
    return (
      <EmptyPanel
        icon={GitCompareArrows}
        title="Pas encore deux passages à comparer"
        description="Il faut au moins deux passages terminés d’une même suite : lancez-en un ou importez un rapport."
      />
    );
  }
  const option = (r: EvalRun) => `${r.label} · ${formatRunDate(r.ran_at)}`;
  const summary = compareSummary(before, after);
  const suites = [...new Set(usable.map((r) => r.suite))];

  return (
    <section aria-label="Comparaison de deux passages" className="flex max-w-4xl flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Suite">
          <SelectBox value={suite} onChange={(e) => onChange({ suite: e.target.value as EvaluationView["suite"], a: null, b: null })}>
            {suites.map((s) => (
              <option key={s} value={s}>
                {SUITES[s]}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Avant">
          <SelectBox value={before.id} onChange={(e) => onChange({ a: e.target.value })}>
            {ofSuite.map((r) => (
              <option key={r.id} value={r.id}>
                {option(r)}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Après">
          <SelectBox value={after.id} onChange={(e) => onChange({ b: e.target.value })}>
            {ofSuite.map((r) => (
              <option key={r.id} value={r.id}>
                {option(r)}
              </option>
            ))}
          </SelectBox>
        </Field>
      </div>
      <p className="type-body text-foreground" role="status">
        {`${summary.better} indicateur${summary.better > 1 ? "s" : ""} en progrès, ${summary.worse} en recul, ${summary.same} inchangé${summary.same > 1 ? "s" : ""}.`}
      </p>
      <IndicatorTable runs={[before, after]} />
    </section>
  );
}
