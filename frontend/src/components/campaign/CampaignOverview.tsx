"use client";

import { EmptyText, KpiStrip, Panel } from "@/components/ds/layout";
import { CountUp } from "@/components/ds/motion";
import { BarList } from "@/components/ds/layout";
import { RATE_THRESHOLDS, percent, rateBadge } from "@/lib/kpi";
import { FUNNEL, LEVELS, label } from "@/lib/labels";
import type { CampaignStats } from "@/lib/types";

const LEVEL_FILL: Record<string, string> = {
  very_hot: "bg-level-very-hot",
  hot: "bg-level-hot",
  warm: "bg-level-warm",
  cold: "bg-level-cold",
  none: "bg-default",
};

function Funnel({ stats }: { stats: CampaignStats }) {
  const rows = FUNNEL.map((step) => ({
    key: step.title,
    label: step.title,
    value: step.stages.reduce((sum, s) => sum + (stats.by_stage[s] ?? 0), 0),
  }));
  return (
    <Panel title="Entonnoir" label="Entonnoir">
      {stats.prospects === 0 ? <EmptyText>Aucun prospect pour l&apos;instant.</EmptyText> : <BarList rows={rows} labelWidth={130} />}
    </Panel>
  );
}

function Levels({ stats }: { stats: CampaignStats }) {
  const order = ["very_hot", "hot", "warm", "cold", "none"];
  return (
    <Panel title="Niveaux d'intérêt" label="Niveaux d'intérêt">
      <BarList
        labelWidth={130}
        rows={order.map((k) => ({
          key: k,
          label: (
            <>
              <span className={`size-2 shrink-0 rounded-full ${LEVEL_FILL[k]}`} aria-hidden="true" />
              {k === "none" ? "Non évalué" : label(LEVELS, k)}
            </>
          ),
          value: stats.by_level[k] ?? 0,
          fill: LEVEL_FILL[k],
        }))}
      />
    </Panel>
  );
}

/** Vue d'ensemble d'une campagne : chiffres clés (le taux de conversion est lu en couleur), entonnoir et niveaux d'intérêt. */
export default function CampaignOverview({ stats }: { stats: CampaignStats }) {
  const conversion = percent(stats.converted, stats.prospects);
  return (
    <div className="flex flex-col gap-4">
      <KpiStrip
        label="Indicateurs de la campagne"
        items={[
          { key: "prospects", label: "Prospects", value: <CountUp value={stats.prospects} /> },
          { key: "score", label: "Score moyen", value: <CountUp value={stats.average_score} decimals={1} /> },
          { key: "meetings", label: "Rendez-vous", value: <CountUp value={stats.meetings} /> },
          {
            key: "converted",
            label: "Convertis",
            value: <CountUp value={stats.converted} />,
            hint: stats.prospects > 0 ? `${conversion} % des prospects` : undefined,
            badge: stats.prospects > 0 ? rateBadge(conversion, RATE_THRESHOLDS.enrolment) : undefined,
          },
        ]}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Funnel stats={stats} />
        <Levels stats={stats} />
      </div>
    </div>
  );
}
