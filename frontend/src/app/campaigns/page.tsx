"use client";

import { Megaphone, Plus } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { FilterChip, LinkButton, Tag, type Tone } from "@/components/ds/controls";
import { EmptyPanel, ErrorState, KpiCard, PageHeader, Screen } from "@/components/ds/layout";
import { DataTable, Table, TablePagination } from "@/components/ds/table";
import { SourceAvatars } from "@/components/ds/SourceAvatars";
import { CountUp, reveal } from "@/components/ds/motion";
import { CAMPAIGN_STATUS, TARGETS, formatDay, label } from "@/lib/labels";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Campaign, CampaignOverview, Page } from "@/lib/types";

const PAGE_SIZE = 5;

/** Apparition échelonnée + rayon « lg » (cartes de chiffres clés). */
const lg = (index: number) => {
  const r = reveal(index);
  return { className: `rounded-lg ${r.className}`, style: r.style };
};

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
  const [page, setPage] = useState(1);
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
  const lastPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, lastPage);
  const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
  const kpiReady = !!everything.data && !!overview.data;

  const STATUS_TONE: Record<string, Tone> = { active: "success", draft: "warning", inactive: "neutral" };

  return (
    <Screen>
      <PageHeader
        {...reveal(0)}
        eyebrow="Pilotage · Campagnes"
        title="Campagnes"
        subtitle="Une campagne regroupe une ou plusieurs sources ; l’agent répond individuellement aux personnes qu’elle amène."
        actions={
          user?.role === "ADMIN" && (
            <LinkButton variant="primary" href="/campaigns/new" className="rounded-lg">
              <Plus className="size-4" aria-hidden="true" />
              Nouvelle campagne
            </LinkButton>
          )
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Chiffres clés">
        <KpiCard
          {...lg(1)}
          label="Campagnes actives"
          value={
            kpiReady ? (
              <>
                <CountUp value={all.filter((c) => c.status === "active").length} /> / <CountUp value={all.length} />
              </>
            ) : (
              "…"
            )
          }
          hint={kpiReady ? `${all.filter((c) => c.status === "draft").length} brouillon(s)` : undefined}
        />
        <KpiCard
          {...lg(2)}
          label="Leads"
          value={kpiReady ? <CountUp value={totals.leads} /> : "…"}
          hint="au total, prospects fictifs exclus"
        />
        <KpiCard
          {...lg(3)}
          label="Taux de qualification"
          value={kpiReady ? <CountUp value={pct(totals.qualified, totals.leads)} suffix=" %" /> : "…"}
          hint={kpiReady ? `${totals.qualified} qualifié(s)` : undefined}
        />
        <KpiCard
          {...lg(4)}
          label="Inscrits"
          value={kpiReady ? <CountUp value={totals.converted} /> : "…"}
          hint={kpiReady ? `${pct(totals.converted, totals.leads)} % des leads` : undefined}
        />
      </section>
      {overview.error && (
        <ErrorState message={`Chiffres indisponibles : ${overview.error.message}`} onRetry={overview.reload} />
      )}

      <div {...{ ...reveal(5), className: `flex flex-wrap gap-1.5 ${reveal(5).className}` }} role="group" aria-label="Statut">
        {user && user.role !== "VIEWER" && (
          <FilterChip className="rounded-lg" pressed={mine} onClick={() => { setMine(!mine); setPage(1); }}>
            Mes campagnes
          </FilterChip>
        )}
        {FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            className="rounded-lg"
            pressed={status === f.value}
            onClick={() => { setStatus(f.value); setPage(1); }}
          >
            {f.text}
          </FilterChip>
        ))}
      </div>

      {list.error && <ErrorState message={list.error.message} onRetry={list.reload} />}
      {!list.error && (
        <DataTable
          {...reveal(6)}
          label="Liste des campagnes"
          minWidth={820}
          isLoading={list.loading && !list.data}
          loadingLabel="Chargement des campagnes…"
          emptyState={
            <EmptyPanel
              icon={Megaphone}
              title={`Aucune campagne${status ? " dans ce statut" : ""}`}
              description={user?.role === "ADMIN" && !status ? "Créez la première avec « Nouvelle campagne »." : undefined}
            />
          }
          columns={[
            { id: "campaign", label: "Campagne", className: "min-w-[240px]" },
            { id: "status", label: "Statut" },
            { id: "sources", label: "Sources" },
            { id: "leads", label: "Leads", className: "text-right" },
            { id: "qualified", label: "Qualifiés", className: "text-right" },
            { id: "converted", label: "Inscrits", className: "text-right" },
          ]}
          footer={
            items.length > PAGE_SIZE ? (
              <TablePagination total={items.length} pageSize={PAGE_SIZE} page={currentPage} onChange={setPage} />
            ) : undefined
          }
        >
          {pageItems.map((c, i) => {
            const f = figures.get(c.id);
            const row = reveal(7 + i, 50);
            return (
              <Table.Row key={c.id} id={c.id} href={`/campaigns/${c.id}`} className={row.className} style={row.style}>
                <Table.Cell>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <strong className="text-sm font-semibold text-foreground">{c.name}</strong>
                    <span className="text-xs text-muted">Responsable : {c.responsible_advisor_name ?? "Non affecté"}</span>
                    <span className="text-xs text-muted">
                      {c.targets.map((t) => label(TARGETS, t.code)).join(", ") || "Aucun programme"}
                      {c.start_date || c.end_date ? ` · ${formatDay(c.start_date)} → ${formatDay(c.end_date)}` : ""}
                    </span>
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <Tag tone={STATUS_TONE[c.status] ?? "neutral"}>{label(CAMPAIGN_STATUS, c.status)}</Tag>
                </Table.Cell>
                <Table.Cell>
                  <span className="flex items-center gap-2">
                    <SourceAvatars sources={c.sources} />
                    <span className="text-[13px] text-muted">
                      {c.sources.length} source{c.sources.length > 1 ? "s" : ""}
                    </span>
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{f?.prospects ?? 0}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">{f?.qualified ?? 0}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">{f?.converted ?? 0}</Table.Cell>
              </Table.Row>
            );
          })}
        </DataTable>
      )}
    </Screen>
  );
}
