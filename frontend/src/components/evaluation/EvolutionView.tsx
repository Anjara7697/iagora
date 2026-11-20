"use client";

import { ChartLine } from "lucide-react";
import { useState } from "react";
import { Field, SelectBox } from "@/components/ds/controls";
import { EmptyPanel } from "@/components/ds/layout";
import { DataTable, Table } from "@/components/ds/table";
import { SUITES, formatNumber, formatRunDate, indicatorOf, runHref, type EvalRun, type EvaluationView, type Suite } from "@/lib/evaluation";

const W = 720;
const H = 260;
const PAD = { top: 16, right: 24, bottom: 36, left: 48 };

type Point = { run: EvalRun; value: number; display: string };

/** Graduations « rondes » de l'axe vertical (4 à 6), à partir de zéro. */
function ticks(max: number, rate: boolean): number[] {
  if (rate) return [0, 0.25, 0.5, 0.75, 1];
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = 0; v <= max + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/**
 * Évolution d'un indicateur d'un passage à l'autre (une série : pas de légende, le titre la nomme). Ligne de 2 px,
 * points de 8 px, grille discrète ; survol ou focus d'un point : infobulle. Le tableau en dessous donne les mêmes
 * valeurs (lecture sans couleur, lecteur d'écran, impression).
 */
function LineChart({ points, rate, label }: { points: Point[]; rate: boolean; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value);
  const scale = ticks(Math.max(...values, rate ? 1 : 0), rate);
  const top = scale[scale.length - 1] || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const shown = active === null ? null : points[active];

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={`${label} : évolution sur ${points.length} passages`}>
        {scale.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-separator" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted type-caption tabular-nums">
              {rate ? `${Math.round(t * 100)} %` : formatNumber(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.run.id} x={x(i)} y={H - 12} textAnchor="middle" className="fill-muted type-caption">
            {new Date(p.run.ran_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
          </text>
        ))}
        {shown && <line x1={x(active!)} x2={x(active!)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-border" strokeDasharray="3 3" />}
        <path d={path} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.run.id}>
            {/* Cible de survol plus large que le point. */}
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r={14}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${p.run.label}, ${formatRunDate(p.run.ran_at)} : ${p.display}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="cursor-pointer outline-none"
            />
            <circle cx={x(i)} cy={y(p.value)} r={active === i ? 5 : 4} className="pointer-events-none fill-accent stroke-surface" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {shown && (
        <div
          className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col gap-0.5 rounded-lg bg-surface px-3 py-2 type-caption shadow-overlay"
          style={{ left: `${(x(active!) / W) * 100}%`, top: `${(y(shown.value) / H) * 100}%`, marginTop: -12 }}
        >
          <span className="font-semibold text-foreground">{shown.run.label}</span>
          <span className="text-muted">{formatRunDate(shown.run.ran_at)}</span>
          <span className="text-foreground tabular-nums">{shown.display}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Évolution des indicateurs d'une suite, du premier passage au dernier (passages lancés et rapports importés).
 * Suite et indicateur dans l'adresse (`?tab=evolution&suite=…&indicator=…`).
 */
export default function EvolutionView({
  runs,
  view,
  onChange,
}: {
  runs: EvalRun[];
  view: EvaluationView;
  onChange: (patch: Partial<EvaluationView>) => void;
}) {
  const usable = runs.filter((r) => r.indicators.length > 0);
  const suites = [...new Set(usable.map((r) => r.suite))] as Suite[];
  const suite = view.suite && suites.includes(view.suite) ? view.suite : suites[0];
  if (!suite) {
    return (
      <EmptyPanel
        icon={ChartLine}
        title="Pas encore de mesure"
        description="La courbe apparaît dès qu’un passage est terminé ou qu’un rapport est importé."
      />
    );
  }
  const ofSuite = usable.filter((r) => r.suite === suite).reverse(); // du plus ancien au plus récent
  const indicators = ofSuite[ofSuite.length - 1].indicators;
  const key = view.indicator && indicators.some((i) => i.key === view.indicator) ? view.indicator : "conform";
  const current = indicators.find((i) => i.key === key) ?? indicators[0];
  const points: Point[] = ofSuite.flatMap((run) => {
    const i = indicatorOf(run, current.key);
    return i && i.value !== null ? [{ run, value: i.value, display: i.display }] : [];
  });
  const sense = current.better === "up" ? "plus haut, mieux" : current.better === "down" ? "plus bas, mieux" : "descriptif";

  return (
    <section aria-label="Évolution des indicateurs" className="flex max-w-4xl flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Suite">
          <SelectBox value={suite} onChange={(e) => onChange({ suite: e.target.value as Suite, indicator: null })}>
            {suites.map((s) => (
              <option key={s} value={s}>
                {SUITES[s]}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Indicateur">
          <SelectBox value={current.key} onChange={(e) => onChange({ suite, indicator: e.target.value })}>
            {indicators.map((i) => (
              <option key={i.key} value={i.key}>
                {`${i.group} · ${i.label}`}
              </option>
            ))}
          </SelectBox>
        </Field>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="type-body font-semibold text-foreground">{current.label}</h2>
        <p className="type-caption text-muted">{`${SUITES[suite]} · ${sense}`}</p>
      </div>
      {points.length === 0 ? (
        <p className="type-body text-muted">Aucun passage ne mesure encore cet indicateur.</p>
      ) : (
        <LineChart points={points} rate={current.kind === "rate"} label={current.label} />
      )}

      {points.length > 0 && (
        // Tableau des valeurs (règle 4) : toute la ligne ouvre le passage.
        <DataTable
          label={`${current.label} par passage`}
          minWidth={420}
          columns={[
            { id: "run", label: "Passage" },
            { id: "date", label: "Date" },
            { id: "value", label: "Valeur", className: "text-right" },
          ]}
        >
          {[...points].reverse().map((p) => (
            <Table.Row key={p.run.id} id={p.run.id} href={runHref(p.run.id)} className="cursor-pointer">
              <Table.Cell>{p.run.label}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-muted tabular-nums">{formatRunDate(p.run.ran_at)}</Table.Cell>
              <Table.Cell className="text-right whitespace-nowrap tabular-nums">{p.display}</Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      )}
    </section>
  );
}
