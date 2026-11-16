"use client";

/**
 * Liste des prospects : une barre (vue, recherche, Mes prospects, À attribuer, filtres, compteur), puis le pipeline
 * ou la table et la pagination. L'état est dans l'adresse (`lib/prospectResults.ts`, `replaceUrl`) ; les vues et le
 * panneau de filtres sont dans `components/prospects/`.
 */

import { Download, SearchX, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { Box } from "@/components/ds/card";
import { Btn, ErrorText, FilterChip, LinkButton, Notice, Segmented, TextInput } from "@/components/ds/controls";
import { type ActiveFilter, FiltersButton, ListToolbar, countLabel } from "@/components/ds/toolbar";
import { EmptyPanel, PageHeader, Screen } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { TablePagination } from "@/components/ds/table";
import { Loading, Skeleton } from "@/components/ui";
import { ProspectFilters } from "@/components/prospects/ProspectFilters";
import { ProspectPipeline } from "@/components/prospects/ProspectPipeline";
import { ProspectTable } from "@/components/prospects/ProspectTable";
import { LIMIT, PIPELINE_LIMIT, membershipFilter } from "@/components/prospects/shared";
import { ApiError, download, qs } from "@/lib/api";
import { CHANNELS, CONSENT, LEVELS, STAGES, TARGETS, label } from "@/lib/labels";
import { prospectResultsHref, readProspectResults, type ProspectResults } from "@/lib/prospectResults";
import type { Campaign, Page, Prospect } from "@/lib/types";
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { WIDE, useMediaQuery } from "@/lib/useMediaQuery";

function Prospects() {
  const params = useSearchParams();
  const state = readProspectResults(params);
  const {
    q, pendingCampaign, stage, campaign, offset, hideDemo, targetCode,
    levelFilter, channelFilter, consentFilter, mine, sourceFilter,
  } = state;
  // Vue choisie, sinon selon la largeur (UX-03) : pipeline à partir de 1024 px, table en dessous. Inconnue avant
  // l'hydratation : rien n'est demandé tant qu'elle ne l'est pas (la taille de page en dépend).
  const wide = useMediaQuery(WIDE);
  const view = state.view || (wide === null ? null : wide ? "pipeline" : "table");
  // File « À attribuer » : réservée à l'administrateur (et visible de l'observateur) ; un conseiller
  // ne voit que les prospects de ses campagnes (décision D-23).
  const user = useCurrentUser();
  const seesPending = !!user && user.role !== "ADVISOR";
  const pending = useApi<Page<Prospect>>(seesPending ? "/prospects?pending_campaign=true&limit=1" : null);
  const canWrite = !!user && user.role !== "VIEWER";
  const [exportError, setExportError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const limit = view === "pipeline" ? PIPELINE_LIMIT : LIMIT;
  const resultsHref = prospectResultsHref(state);
  const profileHref = (id: number) =>
    `/prospects/${id}?from=${encodeURIComponent(resultsHref)}`;

  // État de la liste dans l'adresse, sans entrée d'historique (règle 6) : « Retour » ramène à l'écran précédent.
  function update(patch: Partial<ProspectResults>) {
    // Relit l'adresse courante : deux saisies rapprochées ne s'écrasent pas.
    const current = readProspectResults(new URLSearchParams(window.location.search));
    replaceUrl(prospectResultsHref({ ...current, offset: 0, ...patch }));
  }
  const campaigns = useApi<Page<Campaign>>("/campaigns?limit=200");
  const campaignName = (id: string) => campaigns.data?.items.find((c) => String(c.id) === id)?.name ?? `Campagne ${id}`;
  const sourceName = (id: string) =>
    campaigns.data?.items.find((c) => String(c.id) === campaign)?.sources?.find((s) => String(s.id) === id)?.name ?? `Source ${id}`;
  // Filtres du panneau ; chacun actif s'affiche en puce retirable sous la barre.
  const panelFilters = [
    { name: "Étape", value: stage, text: label(STAGES, stage), clear: () => update({ stage: "" }) },
    { name: "Campagne", value: campaign, text: campaignName(campaign), clear: () => update({ campaign: "", sourceFilter: "" }) },
    { name: "Source", value: sourceFilter, text: sourceName(sourceFilter), clear: () => update({ sourceFilter: "" }) },
    { name: "Programme", value: targetCode, text: label(TARGETS, targetCode), clear: () => update({ targetCode: "" }) },
    { name: "Intérêt", value: levelFilter, text: label(LEVELS, levelFilter), clear: () => update({ levelFilter: "" }) },
    { name: "Canal", value: channelFilter, text: label(CHANNELS, channelFilter), clear: () => update({ channelFilter: "" }) },
    { name: "Consentement", value: consentFilter, text: label(CONSENT, consentFilter), clear: () => update({ consentFilter: "" }) },
  ];
  const active: ActiveFilter[] = [
    ...panelFilters.filter((f) => f.value).map((f) => ({ name: f.name, text: `${f.name} : ${f.text}`, clear: f.clear })),
    ...(hideDemo ? [{ name: "Prospects fictifs", text: "Prospects fictifs masqués", clear: () => update({ hideDemo: false }) }] : []),
  ];
  const panelCount = active.length;
  const filtered = !!(q || mine || pendingCampaign || panelCount);
  // Recherche envoyée une fois la frappe arrêtée (DATA-01) ; le champ et l'adresse suivent la saisie sans délai.
  const searched = useDebouncedValue(q);
  const { data, error, loading, reload } = useApi<Page<Prospect>>(
    view && `/prospects${qs({ q: searched, stage, campaign_id: campaign, source_id: sourceFilter, advisor_id: mine ? user?.id : undefined, pending_campaign: pendingCampaign ? "true" : undefined, demo: hideDemo ? "exclude" : undefined, target_code: targetCode, level: levelFilter, channel: channelFilter, consent_status: consentFilter, limit, offset })}`,
    { keepPrevious: true },
  );
  // Total sans filtre, pour « N sur M » (règle 5) : demandé au premier filtre, puis gardé (DATA-03) au lieu d'être
  // redemandé chaque fois qu'un filtre revient après « Réinitialiser ».
  const [needsAll, setNeedsAll] = useState(false);
  if (filtered && !needsAll) setNeedsAll(true);
  const all = useApi<Page<Prospect>>(needsAll ? "/prospects?limit=1" : null);
  function reset() {
    update({ ...readProspectResults(new URLSearchParams()), view: state.view });
  }
  async function exportCsv() {
    setExportError(null);
    try {
      await download(
        `/prospects/export${qs({ q, stage, campaign_id: campaign, source_id: sourceFilter, advisor_id: mine ? user?.id : undefined, pending_campaign: pendingCampaign ? "true" : undefined, target_code: targetCode, level: levelFilter, channel: channelFilter, consent_status: consentFilter, demo: hideDemo ? "exclude" : "all" })}`,
        "prospects.csv",
      );
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Échec de l’export");
    }
  }
  const memberships = membershipFilter(state, user?.id);
  return (
    <Screen>
      <PageHeader
        {...reveal(0)}
        title="Prospects"
        subtitle="Un parcours, des échanges et une prochaine étape pour chaque prospect."
        actions={
          canWrite && (
            <>
              {/* Sur mobile, « Exporter » seul : les deux actions tiennent sur une ligne (nom accessible complet). */}
              <Btn variant="secondary" aria-label="Exporter en CSV (Excel)" onClick={() => void exportCsv()}>
                <Download className="size-4" aria-hidden="true" />
                <span>
                  Exporter<span className="max-sm:hidden"> en CSV (Excel)</span>
                </span>
              </Btn>
              <LinkButton href="/prospects/import" variant="primary">
                <Upload className="size-4" aria-hidden="true" />
                Importer un CSV
              </LinkButton>
            </>
          )
        }
      />
      {exportError && <ErrorText>{exportError}</ErrorText>}
      {/* Barre au-dessus des résultats (règle 5) : vue, recherche et filtres à gauche, compteur à droite. */}
      <ListToolbar
        {...reveal(1)}
        label="Affichage et filtres des prospects"
        count={data ? countLabel(data.total, "prospect", filtered ? all.data?.total : null) : ""}
        filters={active}
        filtered={filtered}
        onReset={reset}
      >
        <Segmented
          label="Affichage des prospects"
          value={view ?? ""}
          onChange={(v) => update({ view: v as "table" | "pipeline" })}
          options={[
            { value: "pipeline", text: "Pipeline" },
            { value: "table", text: "Table" },
          ]}
        />
        <TextInput
          type="search"
          aria-label="Rechercher"
          placeholder="Nom, email…"
          className="w-full sm:w-64"
          fullWidth={false}
          value={q}
          onChange={(e) => update({ q: e.target.value })}
        />
        {canWrite && (
          <FilterChip className="rounded-lg" pressed={mine} onClick={() => update({ mine: !mine })}>
            Mes prospects
          </FilterChip>
        )}
        {seesPending && (
          <FilterChip
            className="rounded-lg"
            pressed={pendingCampaign}
            onClick={() => update({ pendingCampaign: !pendingCampaign, campaign: "", sourceFilter: "", stage: "" })}
          >
            À attribuer{pending.data ? ` (${pending.data.total})` : ""}
          </FilterChip>
        )}
        <FiltersButton count={panelCount} onPress={() => setFiltersOpen(true)} />
      </ListToolbar>
      {pendingCampaign && (
        <Notice tone="warning">
          Ces prospects attendent une campagne et une source. Ouvrez une fiche pour les attribuer ; l’agent attend cette
          attribution avant de répondre automatiquement.
        </Notice>
      )}
      <ProspectFilters
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        state={state}
        update={update}
        campaigns={campaigns}
        total={data ? data.total : null}
        panelCount={panelCount}
      />
      {/* Pendant une mise à jour (recherche, filtre), la liste précédente reste affichée. */}
      <Loading loading={(loading || !view) && !data} error={error} onRetry={reload} shape="rows" />
      {data && (
        <div className={`flex flex-col gap-6 ${reveal(2).className}`} style={reveal(2).style}>
          {data.items.length === 0 ? (
            <Box as="section" className="p-0">
              <EmptyPanel
                icon={SearchX}
                title="Aucun prospect ne correspond"
                description="Essayez une autre recherche ou réinitialisez les filtres."
                action={<Btn onClick={reset}>Réinitialiser les filtres</Btn>}
              />
            </Box>
          ) : (
            <>
              {view === "pipeline" ? (
                <ProspectPipeline data={data} stage={stage} memberships={memberships} profileHref={profileHref} />
              ) : (
                <ProspectTable items={data.items} memberships={memberships} profileHref={profileHref} />
              )}
            </>
          )}
          {data.total > data.limit && (
            <TablePagination
              total={data.total}
              pageSize={data.limit}
              page={Math.floor(data.offset / data.limit) + 1}
              onChange={(next) => update({ offset: (next - 1) * data.limit })}
            />
          )}
        </div>
      )}
    </Screen>
  );
}

export default function ProspectsPage() {
  return (
    <Suspense fallback={<Skeleton shape="rows" />}>
      <Prospects />
    </Suspense>
  );
}
