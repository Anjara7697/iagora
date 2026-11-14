"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Segmented } from "@/components/ds/controls";
import { BarList, EmptyText, ErrorState, KpiStrip, PageHeader, Panel, Screen, cx } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Skeleton } from "@/components/ui";
import { formatDay } from "@/lib/labels";
import type { Analytics } from "@/lib/types";
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";

const PERIODS = ["7", "30", "90"] as const;
type Period = (typeof PERIODS)[number];

/** Durée lisible : « 45 s », « 12 min », « 3 h 20 », « 2 j 4 h ». */
function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, "0")}` : ""}`;
  const daysCount = Math.floor(hours / 24);
  return `${daysCount} j${hours % 24 ? ` ${hours % 24} h` : ""}`;
}

const percent = (value: number) => `${Math.round(value * 100)} %`;
const share = (count: number, previous: number | undefined) =>
  previous ? `${Math.round((100 * count) / previous)} %` : "—";

/**
 * Analyses (Pilotage) : délais de première réponse, confiance et devenir des brouillons, motifs de refus, couverture
 * de la base de connaissances, conversion par étape. Ce qui n'est pas mesuré l'est dit en clair, jamais estimé.
 */
function AnalyticsScreen() {
  const params = useSearchParams();
  const requested = params.get("days") ?? "";
  const days: Period = (PERIODS as readonly string[]).includes(requested) ? (requested as Period) : "30";
  const api = useApi<Analytics>(`/analytics?days=${days}`, { keepPrevious: true });
  const data = api.data;
  const loading = !data && !api.error;
  const sent = data?.first_reply_sent;
  const drafted = data?.first_reply_drafted;
  const coverage = data?.coverage;
  const d = data?.drafts;

  return (
    <Screen scroll>
      <PageHeader
        {...reveal(0)}
        title="Analyses"
        subtitle={
          data
            ? `Activité depuis le ${formatDay(data.since)}. Les prospects fictifs ne sont pas comptés.`
            : "Activité sur la période. Les prospects fictifs ne sont pas comptés."
        }
        actions={
          <Segmented
            label="Période"
            value={days}
            options={[
              { value: "7", text: "7 jours" },
              { value: "30", text: "30 jours" },
              { value: "90", text: "90 jours" },
            ]}
            onChange={(value) => replaceUrl(value === "30" ? "/analytics" : `/analytics?days=${value}`)}
          />
        }
      />
      {api.error && <ErrorState message={`Analyses indisponibles : ${api.error.message}`} onRetry={api.reload} />}
      {!api.error && (
        <>
          <KpiStrip
            label="Indicateurs"
            startIndex={1}
            items={[
              {
                key: "delay",
                label: "Délai médian de première réponse",
                loading,
                value: sent?.median_seconds != null ? formatDuration(sent.median_seconds) : "—",
                hint:
                  sent && drafted
                    ? `${sent.count ? `envoi réel, ${sent.count} conversation(s)` : "aucune réponse envoyée"} · rédaction de l’agent : ${
                        drafted.median_seconds != null ? formatDuration(drafted.median_seconds) : "—"
                      }`
                    : undefined,
              },
              {
                key: "confidence",
                label: "Confiance moyenne des brouillons",
                loading,
                value: data?.average_confidence != null ? percent(data.average_confidence) : "—",
                hint: d ? `${d.generated} brouillon(s) rédigé(s)` : undefined,
              },
              {
                key: "coverage",
                label: "Couverture de la base de connaissances",
                loading,
                value: coverage?.questions ? percent(coverage.answered / coverage.questions) : "—",
                hint: coverage
                  ? coverage.questions
                    ? `${coverage.answered} question(s) traitée(s) sur ${coverage.questions}`
                    : "aucune question sur la période"
                  : undefined,
              },
              { key: "useful", label: "Escalades utiles", pending: true },
            ]}
          />
          <div className={cx("grid grid-cols-1 items-start gap-6 lg:grid-cols-3", reveal(5).className)} style={reveal(5).style}>
            <Panel label="Devenir des brouillons" title="Devenir des brouillons">
              {loading && <Skeleton shape="rows" />}
              {d && d.generated === 0 && <EmptyText>Aucun brouillon sur la période.</EmptyText>}
              {d && d.generated > 0 && (
                <BarList
                  labelWidth={160}
                  rows={[
                    { key: "unchanged", label: "Validés sans modification", value: d.approved_unchanged, color: "success" as const },
                    { key: "edited", label: "Validés après modification", value: d.approved_edited, color: "accent" as const },
                    { key: "rejected", label: "Refusés", value: d.rejected, color: "danger" as const },
                    { key: "superseded", label: "Remplacés", value: d.superseded },
                    { key: "pending", label: "En attente", value: d.pending, color: "warning" as const },
                  ].map((r) => ({ ...r, title: r.label }))}
                />
              )}
            </Panel>
            <Panel label="Motifs de refus" title="Motifs de refus">
              {loading && <Skeleton shape="rows" />}
              {data && data.reject_reasons.length === 0 && <EmptyText>Aucun refus sur la période.</EmptyText>}
              {data && data.reject_reasons.length > 0 && (
                <ul className="flex flex-col divide-y divide-separator">
                  {data.reject_reasons.map((r) => (
                    <li key={r.reason} className="flex items-start gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                      <span className="min-w-0 flex-1 break-words text-foreground">{r.reason}</span>
                      <span className="text-muted tabular-nums">× {r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel label="Conversion par étape" title="Conversion par étape">
              {loading && <Skeleton shape="rows" />}
              {data && (data.funnel[0]?.count ?? 0) === 0 && <EmptyText>Aucun prospect sur la période.</EmptyText>}
              {data && (data.funnel[0]?.count ?? 0) > 0 && (
                <BarList
                  labelWidth={160}
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
              )}
            </Panel>
          </div>
          <p className="text-xs text-muted">
            Délai : du premier message du prospect à la première réponse réellement envoyée (validation comprise) ;
            la rédaction de l’agent s’arrête au premier message qu’il a rédigé. Couverture : questions lues par l’agent
            auxquelles il a pu répondre avec un extrait validé, sans transfert « question hors base ». Confiance :
            celle de la lecture du message par le modèle. « Escalades utiles » n’est pas encore mesuré.
          </p>
        </>
      )}
    </Screen>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<Skeleton shape="cards" />}>
      <AnalyticsScreen />
    </Suspense>
  );
}
