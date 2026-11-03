"use client";

import { Megaphone, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useCurrentUser } from "@/components/AppShell";
import CampaignsTable from "@/components/CampaignsTable";
import { FilterChip, FilterChipGroup, LinkButton } from "@/components/ds/controls";
import { EmptyPanel, ErrorState, KpiStrip, PageHeader, Screen } from "@/components/ds/layout";
import { CountUp, reveal } from "@/components/ds/motion";
import { TablePagination } from "@/components/ds/table";
import { qs } from "@/lib/api";
import { campaignListHref, readCampaignList, replaceUrl, type CampaignList } from "@/lib/campaignNav";
import { RATE_THRESHOLDS, percent, rateBadge } from "@/lib/kpi";
import { useApi } from "@/lib/useApi";
import type { Campaign, CampaignOverview, Page } from "@/lib/types";

const PAGE_SIZE = 6;

const STATUS_FILTERS = [
  { value: "", text: "Toutes" },
  { value: "active", text: "Actives" },
  { value: "draft", text: "Brouillons" },
  { value: "inactive", text: "Inactives" },
];

export default function CampaignsPage() {
  return (
    <Suspense>
      <Campaigns />
    </Suspense>
  );
}

/** Liste des campagnes ; statut, « Mes campagnes » et page sont dans l'URL (conservés au retour depuis une fiche). */
function Campaigns() {
  const user = useCurrentUser();
  const view = readCampaignList(useSearchParams());
  const { status } = view;
  // « Mes campagnes » n'a pas de sens pour un observateur (aucune campagne ne lui est confiée).
  const mine = view.mine && user?.role !== "VIEWER";
  const listHref = campaignListHref({ ...view, mine });
  const update = (patch: Partial<CampaignList>) =>
    replaceUrl(campaignListHref({ ...readCampaignList(new URLSearchParams(window.location.search)), page: 1, ...patch }));
  const list = useApi<Page<Campaign>>(
    `/campaigns${qs({ status, advisor_id: mine ? user?.id : undefined, limit: 100 })}`,
    { keepPrevious: true },
  );
  const everything = useApi<Page<Campaign>>("/campaigns?limit=100");
  const overview = useApi<CampaignOverview[]>("/campaigns/overview");

  const figures = new Map((overview.data ?? []).map((o) => [o.campaign_id, o]));
  const items = list.data?.items ?? [];
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(view.page, pages);
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Chiffres clés : toutes les campagnes, indépendamment des filtres de la liste.
  const all = everything.data?.items ?? [];
  const totals = (overview.data ?? []).reduce(
    (t, o) => ({ leads: t.leads + o.prospects, qualified: t.qualified + (o.qualified ?? 0), converted: t.converted + o.converted }),
    { leads: 0, qualified: 0, converted: 0 },
  );
  const ready = !!everything.data && !!overview.data;
  const activeCount = all.filter((c) => c.status === "active").length;
  const draftCount = all.filter((c) => c.status === "draft").length;
  const qualification = percent(totals.qualified, totals.leads);
  const enrolment = percent(totals.converted, totals.leads);

  return (
    <Screen scroll>
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

      <KpiStrip
        label="Chiffres clés"
        startIndex={1}
        items={[
          {
            key: "active",
            label: "Campagnes actives",
            value: ready ? (
              <>
                <CountUp value={activeCount} /> / <CountUp value={all.length} />
              </>
            ) : (
              "…"
            ),
            hint: ready ? `${draftCount} brouillon(s)` : undefined,
            badge:
              ready && all.length > 0
                ? activeCount > 0
                  ? { tone: "success", label: "En cours" }
                  : { tone: "warning", label: "À lancer" }
                : undefined,
          },
          {
            key: "leads",
            label: "Leads",
            value: ready ? <CountUp value={totals.leads} /> : "…",
            hint: "au total, prospects fictifs exclus",
          },
          {
            key: "qualification",
            label: "Taux de qualification",
            value: ready ? <CountUp value={qualification} suffix=" %" /> : "…",
            hint: ready ? `${totals.qualified} qualifié(s)` : undefined,
            badge: ready && totals.leads > 0 ? rateBadge(qualification, RATE_THRESHOLDS.qualification) : undefined,
          },
          {
            key: "enrolled",
            label: "Inscrits",
            value: ready ? <CountUp value={totals.converted} /> : "…",
            hint: ready ? `${enrolment} % des leads` : undefined,
            badge: ready && totals.leads > 0 ? rateBadge(enrolment, RATE_THRESHOLDS.enrolment) : undefined,
          },
        ]}
      />
      {overview.error && <ErrorState message={`Chiffres indisponibles : ${overview.error.message}`} onRetry={overview.reload} />}

      <FilterChipGroup
        {...reveal(5)}
        label="Statut"
        options={STATUS_FILTERS}
        value={status}
        onChange={(value) => update({ status: value })}
        leading={
          user &&
          user.role !== "VIEWER" && (
            <FilterChip
              className="rounded-lg"
              pressed={mine}
              onClick={() => update({ mine: !mine })}
            >
              Mes campagnes
            </FilterChip>
          )
        }
      />

      {list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : (
        <CampaignsTable
          campaigns={pageItems}
          figures={figures}
          linkSuffix={listHref === "/campaigns" ? "" : `?from=${encodeURIComponent(listHref)}`}
          isLoading={list.loading && !list.data}
          footer={
            items.length > PAGE_SIZE ? (
              <TablePagination total={items.length} pageSize={PAGE_SIZE} page={page} onChange={(next) => update({ status, mine, page: next })} />
            ) : undefined
          }
          emptyState={
            <EmptyPanel
              icon={Megaphone}
              title={`Aucune campagne${status ? " dans ce statut" : ""}`}
              description={user?.role === "ADMIN" && !status ? "Créez la première avec « Nouvelle campagne »." : undefined}
            />
          }
        />
      )}
    </Screen>
  );
}
