"use client";

import { ChevronRight, Megaphone, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { FilterChip, LinkButton, Tag, type Tone } from "@/components/ds/controls";
import { EmptyPanel, ErrorState, KpiCard, PageHeader, Screen } from "@/components/ds/layout";
import { Loading } from "@/components/ui";
import { CAMPAIGN_STATUS, PLATFORM_MARK, TARGETS, formatDay, label } from "@/lib/labels";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Campaign, CampaignOverview, Page } from "@/lib/types";

const FILTERS = [
  { value: "", text: "Toutes" },
  { value: "active", text: "Actives" },
  { value: "draft", text: "Brouillons" },
  { value: "inactive", text: "Inactives" },
];

export default function CampaignsPage() {
  const user = useCurrentUser();
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const list = useApi<Page<Campaign>>(
    `/campaigns${qs({ status, advisor_id: mine ? user?.id : undefined, limit: 100 })}`,
    {
      keepPrevious: true,
    },
  );
  const everything = useApi<Page<Campaign>>("/campaigns?limit=100");
  const overview = useApi<CampaignOverview[]>("/campaigns/overview");
  const figures = new Map((overview.data ?? []).map((o) => [o.campaign_id, o]));
  const items = list.data?.items ?? [];

  const all = everything.data?.items ?? [];
  const totals = (overview.data ?? []).reduce(
    (t, o) => ({
      leads: t.leads + o.prospects,
      qualified: t.qualified + (o.qualified ?? 0),
      converted: t.converted + o.converted,
    }),
    { leads: 0, qualified: 0, converted: 0 },
  );
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const maxLeads = Math.max(
    1,
    ...(overview.data ?? []).map((o) => o.prospects),
  );
  const kpiReady = !!everything.data && !!overview.data;

  const STATUS_TONE: Record<string, Tone> = { active: "success", draft: "warning", inactive: "neutral" };

  return (
    <Screen>
      <PageHeader
        eyebrow="Pilotage · Campagnes"
        title="Campagnes"
        subtitle="Une campagne regroupe une ou plusieurs sources ; l’agent répond individuellement aux personnes qu’elle amène."
        actions={
          user?.role === "ADMIN" && (
            <LinkButton variant="primary" href="/campaigns/new">
              <Plus className="size-4" aria-hidden="true" />
              Nouvelle campagne
            </LinkButton>
          )
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Chiffres clés">
        <KpiCard
          label="Campagnes actives"
          value={kpiReady ? `${all.filter((c) => c.status === "active").length} / ${all.length}` : "…"}
          hint={kpiReady ? `${all.filter((c) => c.status === "draft").length} brouillon(s)` : undefined}
        />
        <KpiCard label="Leads" value={kpiReady ? totals.leads : "…"} hint="au total, prospects fictifs exclus" />
        <KpiCard
          label="Taux de qualification"
          value={kpiReady ? `${pct(totals.qualified, totals.leads)} %` : "…"}
          hint={kpiReady ? `${totals.qualified} qualifié(s)` : undefined}
        />
        <KpiCard
          label="Inscrits"
          value={kpiReady ? totals.converted : "…"}
          hint={kpiReady ? `${pct(totals.converted, totals.leads)} % des leads` : undefined}
        />
      </section>
      {overview.error && (
        <ErrorState message={`Chiffres indisponibles : ${overview.error.message}`} onRetry={overview.reload} />
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Statut">
        {user && user.role !== "VIEWER" && (
          <FilterChip pressed={mine} onClick={() => setMine(!mine)}>
            Mes campagnes
          </FilterChip>
        )}
        {FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            pressed={status === f.value}
            onClick={() => setStatus(f.value)}
          >
            {f.text}
          </FilterChip>
        ))}
      </div>

      <Loading
        loading={list.loading && !list.data}
        error={list.error}
        onRetry={list.reload}
        shape="rows"
      />
      {list.data && items.length === 0 && (
        <section className="card card--default p-0">
          <EmptyPanel
            icon={Megaphone}
            title={`Aucune campagne${status ? " dans ce statut" : ""}`}
            description={user?.role === "ADMIN" && !status ? "Créez la première avec « Nouvelle campagne »." : undefined}
          />
        </section>
      )}
      {items.length > 0 && (
        <div className="card card--default gap-0 overflow-hidden p-0" role="table" aria-label="Liste des campagnes">
          <div
            className="hidden grid-cols-[minmax(200px,2fr)_120px_minmax(140px,1.2fr)_minmax(200px,1.6fr)_20px] gap-4 bg-surface-secondary px-5 py-2.5 text-xs font-medium text-muted md:grid"
            aria-hidden="true"
          >
            <span>Campagne</span>
            <span>Statut</span>
            <span>Sources</span>
            <span>Leads · Qualifiés · Inscrits</span>
            <span />
          </div>
          {items.map((c) => {
            const f = figures.get(c.id);
            const leads = f?.prospects ?? 0;
            const qualified = f?.qualified ?? 0;
            const converted = f?.converted ?? 0;
            return (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="grid grid-cols-1 items-center gap-3 border-t border-separator px-5 py-4 outline-none transition-colors first:border-t-0 hover:bg-surface-secondary/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset md:grid-cols-[minmax(200px,2fr)_120px_minmax(140px,1.2fr)_minmax(200px,1.6fr)_20px] md:gap-4 md:[&:nth-child(2)]:border-t-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <strong className="text-sm font-semibold text-foreground">{c.name}</strong>
                  <span className="text-xs text-muted">
                    Responsable : {c.responsible_advisor_name ?? "Non affecté"}
                  </span>
                  <span className="text-xs text-muted">
                    {c.targets.map((t) => label(TARGETS, t.code)).join(", ") ||
                      "Aucun programme"}
                    {c.start_date || c.end_date
                      ? ` · ${formatDay(c.start_date)} → ${formatDay(c.end_date)}`
                      : ""}
                  </span>
                </span>
                <span>
                  <Tag tone={STATUS_TONE[c.status] ?? "neutral"}>{label(CAMPAIGN_STATUS, c.status)}</Tag>
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex -space-x-1.5">
                    {c.sources.slice(0, 3).map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex size-6 items-center justify-center rounded-full bg-foreground text-[9px] font-medium text-background ring-2 ring-surface"
                        aria-hidden="true"
                        title={s.name}
                      >
                        {PLATFORM_MARK[s.platform ?? ""] ?? "•"}
                      </span>
                    ))}
                  </span>
                  <span className="text-[13px] text-muted">
                    {c.sources.length} source{c.sources.length > 1 ? "s" : ""}
                  </span>
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className="h-2 overflow-hidden rounded-full bg-surface-tertiary" aria-hidden="true">
                    <span className="block h-full rounded-full bg-accent/35" style={{ width: `${(leads / maxLeads) * 100}%` }}>
                      <span className="block h-full rounded-full bg-accent/70" style={{ width: `${pct(qualified, leads)}%` }}>
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct(converted, qualified)}%` }} />
                      </span>
                    </span>
                  </span>
                  <strong className="text-[13px] font-medium text-foreground tabular-nums">
                    {leads} · {qualified} · {converted}
                  </strong>
                </span>
                <ChevronRight aria-hidden="true" className="hidden size-4 text-muted md:block" />
              </Link>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
