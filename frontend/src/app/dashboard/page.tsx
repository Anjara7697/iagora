"use client";

import { Alert } from "@heroui/react";
import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Btn, LinkButton, Segmented } from "@/components/ds/controls";
import { BarList, EmptyText, ErrorState, KpiStrip, PageHeader, Panel, Screen, cx } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Skeleton } from "@/components/ui";
import { formatDay } from "@/lib/labels";
import type { DashboardOverview, Page, TodoItem } from "@/lib/types";
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";

const PERIODS = ["7", "30", "90"] as const;
type Period = (typeof PERIODS)[number];

/** Part d'une étape par rapport à la précédente, arrondie ; « — » quand la précédente est vide. */
const share = (count: number, previous: number | undefined) =>
  previous ? `${Math.round((100 * count) / previous)} %` : "—";

/** Export de la synthèse (Excel : UTF-8 avec BOM, séparateur « ; »), construit à partir des chiffres affichés. */
function exportCsv(data: DashboardOverview) {
  const rows: (string | number)[][] = [["Section", "Libellé", "Valeur"]];
  rows.push(["Période", "Jours", data.days], ["Période", "Depuis le", formatDay(data.since)]);
  data.funnel.forEach((step, i) => {
    rows.push(["Entonnoir", step.label, step.count]);
    if (i > 0) rows.push(["Entonnoir (% de l'étape précédente)", step.label, share(step.count, data.funnel[i - 1].count)]);
  });
  data.by_target.forEach((b) => rows.push(["Par programme", b.label, b.count]));
  data.by_source.forEach((b) => rows.push(["Par source", b.label, b.count]));
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const body = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `tableau-de-bord-${data.days}j.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Tableau de bord (Pilotage) : prospects arrivés sur 7, 30 ou 90 jours (fictifs exclus). Les étapes sont comptées
 * « atteintes » : un prospect passé par un rendez-vous puis perdu reste compté dans « Rendez-vous planifiés ».
 */
function Dashboard() {
  const params = useSearchParams();
  const requested = params.get("days") ?? "";
  const days: Period = (PERIODS as readonly string[]).includes(requested) ? (requested as Period) : "30";
  const overview = useApi<DashboardOverview>(`/dashboard/overview?days=${days}`, { keepPrevious: true });
  const incidents = useApi<Page<TodoItem>>("/todo?kind=incident&limit=1");
  const data = overview.data;
  const incident = incidents.data?.items[0];
  const step = (key: string) => data?.funnel.find((s) => s.key === key)?.count ?? 0;
  const leads = data?.leads ?? 0;
  const ofLeads = (n: number) => (leads ? `${Math.round((100 * n) / leads)} % des leads` : undefined);
  const loading = !data && !overview.error;

  return (
    <Screen scroll>
      {incident && (
        <Alert status="danger" role="alert" {...reveal(0)}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{incident.title}</Alert.Title>
            {incident.detail && <Alert.Description>{incident.detail}</Alert.Description>}
          </Alert.Content>
          <LinkButton size="sm" variant="danger" href={`/todo?id=${encodeURIComponent(incident.id)}`}>
            Diagnostiquer
          </LinkButton>
        </Alert>
      )}
      <PageHeader
        {...reveal(0)}
        eyebrow="Pilotage · Tableau de bord"
        title="Tableau de bord"
        subtitle={
          data
            ? `Prospects arrivés depuis le ${formatDay(data.since)}. Les prospects fictifs ne sont pas comptés.`
            : "Prospects arrivés sur la période. Les prospects fictifs ne sont pas comptés."
        }
        actions={
          <>
            <Segmented
              label="Période"
              value={days}
              options={[
                { value: "7", text: "7 jours" },
                { value: "30", text: "30 jours" },
                { value: "90", text: "90 jours" },
              ]}
              onChange={(value) => replaceUrl(value === "30" ? "/dashboard" : `/dashboard?days=${value}`)}
            />
            <Btn variant="outline" disabled={!data} onClick={() => data && exportCsv(data)}>
              <Download className="size-4" aria-hidden="true" />
              Exporter en CSV
            </Btn>
          </>
        }
      />
      {overview.error && (
        <ErrorState message={`Tableau de bord indisponible : ${overview.error.message}`} onRetry={overview.reload} />
      )}
      {!overview.error && (
        <>
          <KpiStrip
            label="Chiffres clés"
            startIndex={1}
            items={[
              { key: "leads", label: "Leads reçus", value: leads, loading, hint: `sur ${days} jours` },
              { key: "qualified", label: "Qualifiés", value: step("qualified"), loading, hint: ofLeads(step("qualified")) },
              { key: "meeting", label: "Rendez-vous planifiés", value: step("meeting"), loading, hint: ofLeads(step("meeting")) },
              { key: "converted", label: "Inscrits", value: step("converted"), loading, hint: ofLeads(step("converted")) },
            ]}
          />
          <div className={cx("grid grid-cols-1 items-start gap-6 lg:grid-cols-3", reveal(5).className)} style={reveal(5).style}>
            <Panel label="Entonnoir" title="Entonnoir">
              {loading && <Skeleton shape="rows" />}
              {data && leads === 0 && <EmptyText>Aucun prospect sur la période.</EmptyText>}
              {data && leads > 0 && (
                <div className="flex flex-col gap-4">
                  <BarList
                    labelWidth={150}
                    rows={data.funnel.map((s, i) => ({
                      key: s.key,
                      title: s.label,
                      label: (
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{s.label}</span>
                          {i > 0 && (
                            <span className="text-xs text-muted tabular-nums">
                              {share(s.count, data.funnel[i - 1].count)} de l’étape précédente
                            </span>
                          )}
                        </span>
                      ),
                      value: s.count,
                    }))}
                  />
                  <p className="text-xs text-muted">
                    Étape atteinte au moins une fois : un prospect perdu après un rendez-vous reste compté dans
                    « Rendez-vous planifiés ».
                  </p>
                </div>
              )}
            </Panel>
            <Breakdown title="Par programme" rows={data?.by_target} loading={loading} />
            <Breakdown title="Par source" rows={data?.by_source} loading={loading} />
          </div>
        </>
      )}
    </Screen>
  );
}

function Breakdown({
  title,
  rows,
  loading,
}: {
  title: string;
  rows: DashboardOverview["by_target"] | undefined;
  loading: boolean;
}) {
  return (
    <Panel label={title} title={title}>
      {loading && <Skeleton shape="rows" />}
      {rows && rows.length === 0 && <EmptyText>Aucun prospect sur la période.</EmptyText>}
      {rows && rows.length > 0 && (
        <BarList
          labelWidth={150}
          rows={rows.map((b) => ({
            key: b.key ?? "none",
            title: b.label,
            label: <span className="truncate">{b.label}</span>,
            value: b.count,
          }))}
        />
      )}
    </Panel>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<Skeleton shape="cards" />}>
      <Dashboard />
    </Suspense>
  );
}
