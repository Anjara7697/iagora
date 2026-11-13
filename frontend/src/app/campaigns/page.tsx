"use client";

import { Megaphone, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { useCurrentUser } from "@/lib/session";
import CampaignsTable from "@/components/CampaignsTable";
import { Btn, FilterChip, FilterChipGroup, LinkButton } from "@/components/ds/controls";
import { EmptyPanel, ErrorState, KpiStrip, PageHeader, Screen } from "@/components/ds/layout";
import { CountUp, reveal } from "@/components/ds/motion";
import { TablePagination } from "@/components/ds/table";
import { qs } from "@/lib/api";
import { campaignListHref, readCampaignList, replaceUrl, type CampaignList } from "@/lib/campaignNav";
import { RATE_THRESHOLDS, percent, rateBadge } from "@/lib/kpi";
import { label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Campaign, CampaignOverview, Page } from "@/lib/types";

const PAGE_SIZE = 6;

const STATUS_FILTERS = [
  { value: "", text: "Toutes" },
  { value: "active", text: "Actives" },
  { value: "draft", text: "Brouillons" },
  { value: "inactive", text: "En pause" },
];
const CAMPAIGN_FILTER_LABELS = Object.fromEntries(STATUS_FILTERS.map((f) => [f.value, f.text]));

export default function CampaignsPage() {
  return (
    <Suspense>
      <Campaigns />
    </Suspense>
  );
}

/**
 * Liste des campagnes ; statut, « Mes campagnes » et page sont dans l'URL (conservés au retour depuis une fiche).
 * Pagination côté serveur (`limit`/`offset`) ; les chiffres clés comptent toutes les campagnes par le `total` de l'API.
 */
function Campaigns() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const view = readCampaignList(useSearchParams());
  const { status } = view;
  // « Mes campagnes » n'a pas de sens pour un observateur (aucune campagne ne lui est confiée).
  const mine = view.mine && user?.role !== "VIEWER";
  const filtered = !!status || mine;
  const listHref = campaignListHref({ ...view, mine });
  const update = (patch: Partial<CampaignList>) =>
    replaceUrl(campaignListHref({ ...readCampaignList(new URLSearchParams(window.location.search)), page: 1, ...patch }));

  const list = useApi<Page<Campaign>>(
    `/campaigns${qs({ status, advisor_id: mine ? user?.id : undefined, limit: PAGE_SIZE, offset: (view.page - 1) * PAGE_SIZE })}`,
    { keepPrevious: true },
  );
  // Chiffres clés : toutes les campagnes, indépendamment des filtres de la liste.
  const allCount = useApi<Page<Campaign>>("/campaigns?limit=1");
  const activeCount = useApi<Page<Campaign>>("/campaigns?status=active&limit=1");
  const draftCount = useApi<Page<Campaign>>("/campaigns?status=draft&limit=1");
  const overview = useApi<CampaignOverview[]>("/campaigns/overview");

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Page hors limites (lien ancien, campagne retirée) : on revient à la dernière page existante.
  useEffect(() => {
    if (list.data && view.page > pages) update({ page: pages });
  }, [list.data, view.page, pages]);

  const figures = new Map((overview.data ?? []).map((o) => [o.campaign_id, o]));
  const totals = (overview.data ?? []).reduce(
    (t, o) => ({ leads: t.leads + o.prospects, qualified: t.qualified + (o.qualified ?? 0), converted: t.converted + o.converted }),
    { leads: 0, qualified: 0, converted: 0 },
  );
  const counts = [allCount, activeCount, draftCount];
  const kpiError = overview.error ?? counts.find((c) => c.error)?.error ?? null;
  const retryKpis = () => [overview, ...counts].forEach((c) => c.error && c.reload());
  const ready = !kpiError && counts.every((c) => c.data) && !!overview.data;
  const campaignsTotal = allCount.data?.total ?? 0;
  const active = activeCount.data?.total ?? 0;
  const qualification = percent(totals.qualified, totals.leads);
  const enrolment = percent(totals.converted, totals.leads);
  // En erreur, les chiffres affichent « — » au lieu d'un chargement sans fin.
  const kpi = (value: ReactNode) => (ready ? value : "—");
  const loading = !ready && !kpiError;

  const filterText = [status && label(CAMPAIGN_FILTER_LABELS, status), mine && "Mes campagnes"].filter(Boolean).join(" · ");

  return (
    <Screen scroll>
      <PageHeader
        {...reveal(0)}
        eyebrow="Pilotage · Campagnes"
        title="Campagnes"
        subtitle="Une campagne regroupe une ou plusieurs sources ; l’agent répond individuellement aux personnes qu’elle amène."
        actions={
          isAdmin && (
            <LinkButton variant="primary" href="/campaigns/new">
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
            loading,
            value: kpi(
              <>
                <CountUp value={active} /> / <CountUp value={campaignsTotal} />
              </>,
            ),
            hint: ready ? `${draftCount.data?.total ?? 0} brouillon(s)` : undefined,
            badge:
              ready && campaignsTotal > 0
                ? active > 0
                  ? { tone: "success", label: "En cours" }
                  : { tone: "warning", label: "À lancer" }
                : undefined,
          },
          {
            key: "leads",
            label: "Leads",
            loading,
            value: kpi(<CountUp value={totals.leads} />),
            hint: "au total, prospects fictifs exclus",
          },
          {
            key: "qualification",
            label: "Taux de qualification",
            loading,
            value: kpi(<CountUp value={qualification} suffix=" %" />),
            hint: ready ? `${totals.qualified} qualifié(s)` : undefined,
            badge: ready && totals.leads > 0 ? rateBadge(qualification, RATE_THRESHOLDS.qualification) : undefined,
          },
          {
            key: "enrolled",
            label: "Inscrits",
            loading,
            value: kpi(<CountUp value={totals.converted} />),
            hint: ready ? `${enrolment} % des leads` : undefined,
            badge: ready && totals.leads > 0 ? rateBadge(enrolment, RATE_THRESHOLDS.enrolment) : undefined,
          },
        ]}
      />
      {/* Une seule alerte par panne : si la liste échoue aussi, son « Réessayer » recharge les chiffres. */}
      {kpiError && !list.error && <ErrorState message={`Chiffres clés indisponibles : ${kpiError.message}`} onRetry={retryKpis} />}

      {/* Barre au-dessus du tableau (règle des parcours) : filtres à gauche, compteur à droite. */}
      <div style={reveal(5).style} className={`flex flex-wrap items-center justify-between gap-3 ${reveal(5).className}`}>
        <FilterChipGroup
          label="Statut"
          options={STATUS_FILTERS}
          value={status}
          onChange={(value) => update({ status: value })}
          leading={
            user &&
            user.role !== "VIEWER" && (
              <FilterChip pressed={mine} onClick={() => update({ mine: !mine })}>
                Mes campagnes
              </FilterChip>
            )
          }
        />
        <span className="text-[13px] text-muted tabular-nums" role="status">
          {list.data
            ? `${total} campagne${total > 1 ? "s" : ""}${filtered && allCount.data ? ` sur ${allCount.data.total}` : ""}`
            : ""}
        </span>
      </div>

      {list.error ? (
        <ErrorState
          message={`Impossible de charger les campagnes : ${list.error.message}`}
          onRetry={() => {
            list.reload();
            retryKpis();
          }}
        />
      ) : (
        <CampaignsTable
          campaigns={list.data?.items ?? []}
          figures={figures}
          linkSuffix={listHref === "/campaigns" ? "" : `?from=${encodeURIComponent(listHref)}`}
          isLoading={list.loading && !list.data}
          footer={
            total > PAGE_SIZE ? (
              <TablePagination total={total} pageSize={PAGE_SIZE} page={Math.min(view.page, pages)} onChange={(next) => update({ page: next })} />
            ) : undefined
          }
          emptyState={
            filtered ? (
              <EmptyPanel
                icon={Megaphone}
                title="Aucune campagne ne correspond à ces filtres"
                description={`Filtres actifs : ${filterText}.`}
                action={
                  <Btn variant="secondary" onClick={() => update({ status: "", mine: false })}>
                    Afficher toutes les campagnes
                  </Btn>
                }
              />
            ) : (
              <EmptyPanel
                icon={Megaphone}
                title="Aucune campagne pour l’instant"
                description={
                  isAdmin
                    ? "Une campagne regroupe les sources d’où arrivent les prospects. Elle est créée en brouillon : rien ne démarre avant son activation."
                    : "Les campagnes créées par un administrateur apparaîtront ici."
                }
                action={
                  isAdmin && (
                    <LinkButton variant="primary" href="/campaigns/new">
                      <Plus className="size-4" aria-hidden="true" />
                      Nouvelle campagne
                    </LinkButton>
                  )
                }
              />
            )
          }
        />
      )}
    </Screen>
  );
}
