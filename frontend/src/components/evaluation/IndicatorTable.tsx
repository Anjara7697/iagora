"use client";

import { ArrowDownRight, ArrowUpRight, Equal } from "lucide-react";
import { Tag } from "@/components/ds/controls";
import { compareValues, indicatorOf, type Change, type EvalRun, type Indicator } from "@/lib/evaluation";

const CHANGE: Record<Change, { tone: "success" | "danger" | "neutral" | "muted"; text: string }> = {
  better: { tone: "success", text: "en progrès" },
  worse: { tone: "danger", text: "en recul" },
  same: { tone: "muted", text: "inchangé" },
  neutral: { tone: "neutral", text: "écart" },
  unknown: { tone: "muted", text: "" },
};

function ChangeTag({ before, after }: { before?: Indicator; after?: Indicator }) {
  const { change, delta } = compareValues(before, after);
  if (change === "unknown") return <span className="type-caption text-muted">-</span>;
  const c = CHANGE[change];
  const Icon = change === "same" ? Equal : (after?.value ?? 0) > (before?.value ?? 0) ? ArrowUpRight : ArrowDownRight;
  // L'appréciation est écrite (« en progrès ») : la couleur n'est jamais le seul signal.
  return (
    <Tag tone={c.tone} icon={<Icon className="size-3.5" aria-hidden="true" />}>
      {change === "same" ? c.text : `${delta} · ${c.text}`}
    </Tag>
  );
}

/**
 * Indicateurs d'un passage, ou de deux passages côte à côte avec l'écart et son sens (comparaison), regroupés comme
 * dans le rapport : conformité, style, technique de vente, coût. Un indicateur absent d'un rapport ancien vaut « n/a ».
 */
export default function IndicatorTable({ runs }: { runs: [EvalRun] | [EvalRun, EvalRun] }) {
  const [first, second] = runs;
  const reference = second ?? first;
  const groups = [...new Set(reference.indicators.map((i) => i.group))];
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group} aria-label={group} className="flex flex-col">
          <h3 className="border-b border-separator pb-2 type-body font-semibold text-foreground">{group}</h3>
          {/* Largeurs fixes : les colonnes restent alignées d'un groupe à l'autre. */}
          <table className="w-full table-fixed type-body-sm">
            <colgroup>
              <col className={second ? "w-[40%]" : "w-[70%]"} />
              <col />
              {second && <col />}
              {second && <col className="w-[26%]" />}
            </colgroup>
            <thead className="sr-only">
              <tr>
                <th scope="col">Indicateur</th>
                <th scope="col">{second ? first.label : "Valeur"}</th>
                {second && <th scope="col">{second.label}</th>}
                {second && <th scope="col">Écart</th>}
              </tr>
            </thead>
            <tbody>
              {reference.indicators
                .filter((i) => i.group === group)
                .map((i) => {
                  const a = indicatorOf(first, i.key);
                  const b = second ? indicatorOf(second, i.key) : undefined;
                  return (
                    <tr key={i.key} className="border-b border-separator/60 last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-normal text-muted">
                        {i.label}
                      </th>
                      <td className="py-2 pr-3 text-right whitespace-nowrap text-foreground tabular-nums">{a?.display ?? "n/a"}</td>
                      {second && <td className="py-2 pr-3 text-right whitespace-nowrap text-foreground tabular-nums">{b?.display ?? "n/a"}</td>}
                      {second && (
                        <td className="py-2 text-right">
                          <ChangeTag before={a} after={b} />
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

/** Bilan d'une comparaison en une ligne : combien d'indicateurs progressent, reculent, ne bougent pas. */
export function compareSummary(before: EvalRun, after: EvalRun): { better: number; worse: number; same: number } {
  const out = { better: 0, worse: 0, same: 0 };
  for (const i of after.indicators) {
    const { change } = compareValues(indicatorOf(before, i.key), i);
    if (change === "better" || change === "worse" || change === "same") out[change] += 1;
  }
  return out;
}
