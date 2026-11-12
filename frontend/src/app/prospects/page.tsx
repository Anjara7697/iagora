"use client";

/**
 * Liste des prospects : une barre (vue, recherche, Mes prospects, À attribuer, filtres, compteur), puis le pipeline
 * ou la table et la pagination. L'état est dans l'adresse (`lib/prospectResults.ts`, `replaceUrl`) ; les vues et le
 * panneau de filtres sont dans `components/prospects/`.
 */

import { Chip } from "@heroui/react";
import { Download, SearchX, SlidersHorizontal, Upload, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Box } from "@/components/ds/card";
import { Btn, ErrorText, FilterChip, LinkButton, Notice, Segmented, TextInput } from "@/components/ds/controls";
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

function Prospects() {
  const params = useSearchParams();
  const state = readProspectResults(params);
  const {
    q, pendingCampaign, stage, campaign, offset, hideDemo, targetCode,
    levelFilter, channelFilter, consentFilter, mine, sourceFilter, view,
  } = state;
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
    { title: "Étape", value: stage, text: label(STAGES, stage), clear: () => update({ stage: "" }) },
    { title: "Campagne", value: campaign, text: campaignName(campaign), clear: () => update({ campaign: "", sourceFilter: "" }) },
    { title: "Source", value: sourceFilter, text: sourceName(sourceFilter), clear: () => update({ sourceFilter: "" }) },
    { title: "Programme", value: targetCode, text: label(TARGETS, targetCode), clear: () => update({ targetCode: "" }) },
    { title: "Intérêt", value: levelFilter, text: label(LEVELS, levelFilter), clear: () => update({ levelFilter: "" }) },
    { title: "Canal", value: channelFilter, text: label(CHANNELS, channelFilter), clear: () => update({ channelFilter: "" }) },
    { title: "Consentement", value: consentFilter, text: label(CONSENT, consentFilter), clear: () => update({ consentFilter: "" }) },
  ];
  const activePanel = panelFilters.filter((f) => f.value);
  const panelCount = activePanel.length + (hideDemo ? 1 : 0);
  const filtered = !!(q || mine || pendingCampaign || panelCount);
  const { data, error, loading, reload } = useApi<Page<Prospect>>(
    `/prospects${qs({ q, stage, campaign_id: campaign, source_id: sourceFilter, advisor_id: mine ? user?.id : undefined, pending_campaign: pendingCampaign ? "true" : undefined, demo: hideDemo ? "exclude" : undefined, target_code: targetCode, level: levelFilter, channel: channelFilter, consent_status: consentFilter, limit, offset })}`,
    { keepPrevious: true },
  );
  // Total sans filtre, pour « N sur M » (règle 5).
  const all = useApi<Page<Prospect>>(filtered ? "/prospects?limit=1" : null);
  function reset() {
    update({ ...readProspectResults(new URLSearchParams()), view });
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
        eyebrow="Travail · Suivi commercial"
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
      <section
        className={`flex flex-col gap-2 ${reveal(1).className}`}
        style={reveal(1).style}
        aria-label="Affichage et filtres des prospects"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Affichage des prospects"
            value={view}
            onChange={(v) => update({ view: v })}
            options={[
              { value: "pipeline", text: "Pipeline" },
              { value: "table", text: "Table" },
            ]}
          />
          <TextInput
            variant="secondary"
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
          <Btn variant="secondary" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filtres
            {panelCount > 0 && (
              <Chip size="sm" color="accent" variant="primary" aria-label={`${panelCount} actif${panelCount > 1 ? "s" : ""}`}>
                <Chip.Label>{panelCount}</Chip.Label>
              </Chip>
            )}
          </Btn>
          <span className="flex-1" />
          <span className="text-[13px] text-muted tabular-nums" role="status">
            {data
              ? `${data.total} prospect${data.total > 1 ? "s" : ""}${filtered && all.data ? ` sur ${all.data.total}` : ""}`
              : ""}
          </span>
        </div>
        {(panelCount > 0 || filtered) && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Filtres actifs">
            {activePanel.map((f) => (
              <Btn key={f.title} size="sm" variant="tertiary" aria-label={`Retirer le filtre ${f.title}`} onClick={f.clear}>
                {f.title} : {f.text}
                <X className="size-3.5 text-muted" aria-hidden="true" />
              </Btn>
            ))}
            {hideDemo && (
              <Btn size="sm" variant="tertiary" aria-label="Retirer le filtre Prospects fictifs" onClick={() => update({ hideDemo: false })}>
                Prospects fictifs masqués
                <X className="size-3.5 text-muted" aria-hidden="true" />
              </Btn>
            )}
            <Btn size="sm" variant="ghost" className="text-link" onClick={reset}>
              Réinitialiser
            </Btn>
          </div>
        )}
      </section>
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
      <Loading loading={loading && !data} error={error} onRetry={reload} shape="rows" />
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
