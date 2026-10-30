"use client";

import { Avatar as HeroAvatar } from "@heroui/react";
import { ChevronLeft, ChevronRight, Download, SearchX, SlidersHorizontal, Upload, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Btn, Check, ErrorText, Field, FilterChip, LinkButton, Segmented, SelectInput, Tag, TextInput } from "@/components/ds/controls";
import { EmptyPanel, PageHeader, Screen } from "@/components/ds/layout";
import { DemoBadge, Loading, Pager, ScoreBadge, StageBadge, Skeleton } from "@/components/ui";
import {
  formatDate,
  fullName,
  label,
  CHANNELS,
  CONSENT,
  LEVELS,
  STAGES,
  TARGETS,
} from "@/lib/labels";
import { ApiError, download, qs } from "@/lib/api";
import { useCurrentUser } from "@/components/AppShell";
import { useApi } from "@/lib/useApi";
import {
  prospectResultsHref,
  readProspectResults,
  type ProspectResults,
} from "@/lib/prospectResults";
import type { Campaign, Membership, Page, Prospect } from "@/lib/types";

const LIMIT = 25;
// Le pipeline affiche plus de prospects par page pour que les colonnes soient représentatives.
const PIPELINE_LIMIT = 100;
const PIPELINE_COLUMNS = [
  { key: "unassigned", title: "Sans campagne", stages: [] as string[] },
  { key: "new", title: "À qualifier", stages: ["new", "to_qualify"] },
  {
    key: "conversation",
    title: "En échange",
    stages: ["contacted", "in_conversation"],
  },
  { key: "qualified", title: "Qualifié", stages: ["qualified"] },
  {
    key: "meeting",
    title: "Rendez-vous",
    stages: ["meeting_proposed", "meeting_scheduled", "meeting_done"],
  },
  { key: "applied", title: "Candidature", stages: ["applied"] },
  { key: "converted", title: "Converti", stages: ["converted"] },
  { key: "follow_up", title: "À relancer", stages: ["to_follow_up"] },
  { key: "exit", title: "Sorties", stages: ["lost"] },
];
const level = (t: number) =>
  t >= 75 ? "very_hot" : t >= 50 ? "hot" : t >= 25 ? "warm" : "cold";
function Avatar({ prospect, size = "sm" }: { prospect: Prospect; size?: "sm" | "md" }) {
  return (
    <HeroAvatar size={size} variant="soft" color="accent" aria-hidden="true">
      <HeroAvatar.Fallback>
        {[prospect.first_name, prospect.last_name]
          .filter(Boolean)
          .map((s) => s![0])
          .join("")
          .slice(0, 2)
          .toUpperCase() || "?"}
      </HeroAvatar.Fallback>
    </HeroAvatar>
  );
}

const CONSENT_TONE: Record<string, "success" | "danger" | "neutral" | "warning"> = {
  granted: "success",
  opted_out: "danger",
  pending: "warning",
};

function ConsentTag({ status }: { status: string }) {
  return <Tag tone={CONSENT_TONE[status] ?? "neutral"}>{label(CONSENT, status)}</Tag>;
}

/** Pipeline défilant : indique qu'il reste des colonnes à droite (ou à gauche). */
function PipelineScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges({
        left: el.scrollLeft > 4,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [children]);
  const scroll = (direction: 1 | -1) =>
    ref.current?.scrollBy({ left: direction * 260, behavior: "smooth" });
  return (
    <div className="relative">
      <div
        ref={ref}
        className="flex snap-x gap-4 overflow-x-auto pb-3 outline-none focus-visible:ring-2 focus-visible:ring-focus"
        tabIndex={0}
        role="region"
        aria-label="Pipeline des prospects, défilement horizontal"
      >
        {children}
      </div>
      {edges.left && (
        <button
          type="button"
          className="absolute top-3 left-2 inline-flex size-9 items-center justify-center rounded-full bg-overlay text-foreground shadow-overlay outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
          aria-label="Étapes précédentes"
          onClick={() => scroll(-1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          className="absolute top-3 right-2 inline-flex size-9 items-center justify-center rounded-full bg-overlay text-foreground shadow-overlay outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
          aria-label="Étapes suivantes"
          onClick={() => scroll(1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function Prospects() {
  const params = useSearchParams();
  const state = readProspectResults(params);
  const {
    q, pendingCampaign, stage, campaign, offset, hideDemo, targetCode,
    levelFilter, channelFilter, consentFilter, mine, sourceFilter, view,
  } = state;
  const pending = useApi<Page<Prospect>>("/prospects?pending_campaign=true&limit=1");
  const user = useCurrentUser();
  const [exportError, setExportError] = useState<string | null>(null);
  const limit = view === "pipeline" ? PIPELINE_LIMIT : LIMIT;
  const resultsHref = prospectResultsHref(state);
  const profileHref = (id: number) =>
    `/prospects/${id}?from=${encodeURIComponent(resultsHref)}`;

  function update(patch: Partial<ProspectResults>, replace = false) {
    // Read the latest URL so successive input events never overwrite another filter.
    const current = readProspectResults(
      new URLSearchParams(window.location.search),
    );
    const href = prospectResultsHref({ ...current, offset: 0, ...patch });
    if (href === window.location.pathname + window.location.search) return;
    // Next.js synchronizes native history changes with useSearchParams.
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
  }
  const advanced = [
    {
      title: "Programme",
      id: "target-filter",
      value: targetCode,
      set: (value: string) => update({ targetCode: value }),
      options: TARGETS,
      all: "Tous les programmes",
    },
    {
      title: "Intérêt",
      id: "level-filter",
      value: levelFilter,
      set: (value: string) => update({ levelFilter: value }),
      options: LEVELS,
      all: "Tous les niveaux",
    },
    {
      title: "Canal",
      id: "channel-filter",
      value: channelFilter,
      set: (value: string) => update({ channelFilter: value }),
      options: CHANNELS,
      all: "Tous les canaux",
    },
    {
      title: "Consentement",
      id: "consent-filter",
      value: consentFilter,
      set: (value: string) => update({ consentFilter: value }),
      options: CONSENT,
      all: "Tous",
    },
  ];
  const activeAdvanced = advanced.filter((f) => f.value);
  const activeFilterCount = [
    q,
    stage,
    campaign,
    sourceFilter,
    targetCode,
    levelFilter,
    channelFilter,
    consentFilter,
    hideDemo ? "demo" : "",
  ].filter(Boolean).length;
  const [moreOpen, setMoreOpen] = useState(false);
  const { data, error, loading, reload } = useApi<Page<Prospect>>(
    `/prospects${qs({ q, stage, campaign_id: campaign, source_id: sourceFilter, advisor_id: mine ? user?.id : undefined, pending_campaign: pendingCampaign ? "true" : undefined, demo: hideDemo ? "exclude" : undefined, target_code: targetCode, level: levelFilter, channel: channelFilter, consent_status: consentFilter, limit, offset })}`,
    { keepPrevious: true },
  );
  const campaigns = useApi<Page<Campaign>>("/campaigns?limit=200");
  function reset() {
    update({ ...readProspectResults(new URLSearchParams()), view });
  }
  function membershipsOf(p: Prospect): Membership[] {
    return p.campaigns.filter(
      (m) =>
        (!campaign || m.campaign_id === Number(campaign)) &&
        (!sourceFilter || m.source_id === Number(sourceFilter)) &&
        (!stage || m.conversion_stage === stage) &&
        (!levelFilter || m.interest_status === levelFilter) &&
        (!mine || m.assigned_advisor_id === user?.id),
    );
  }
  const columns = PIPELINE_COLUMNS.filter(
    (column) =>
      (!stage || column.stages.includes(stage) || column.key === "exit") &&
      (column.key !== "unassigned" ||
        data?.items.some((p) => p.campaigns.length === 0)),
  );
  function inColumn(p: Prospect, column: (typeof PIPELINE_COLUMNS)[number]) {
    if (column.key === "exit")
      return (
        p.consent_status === "opted_out" ||
        membershipsOf(p).some((m) => m.conversion_stage === "lost")
      );
    if (p.consent_status === "opted_out") return false;
    if (column.key === "unassigned") return p.campaigns.length === 0;
    return membershipsOf(p).some((m) =>
      column.stages.includes(m.conversion_stage),
    );
  }
  return (
    <Screen>
      <PageHeader
        eyebrow="Travail · Suivi commercial"
        title="Prospects"
        subtitle="Un parcours, des échanges et une prochaine étape pour chaque prospect."
        actions={
          user &&
          user.role !== "VIEWER" && (
            <LinkButton href="/prospects/import" variant="primary">
              <Upload className="size-4" aria-hidden="true" />
              Importer un CSV
            </LinkButton>
          )
        }
      />
      <section
        className="card card--default flex-row flex-wrap items-center gap-2 p-3"
        aria-label="Affichage et périmètre des prospects"
      >
        <Segmented
          label="Affichage des prospects"
          value={view}
          onChange={(v) => update({ view: v })}
          options={[
            { value: "pipeline", text: "Pipeline" },
            { value: "table", text: "Table" },
          ]}
        />
        <span className="mx-1 hidden h-6 w-px bg-separator sm:block" aria-hidden="true" />
        {user && user.role !== "VIEWER" && (
          <FilterChip
            pressed={mine}
            onClick={() => {
              update({ mine: !mine });
            }}
          >
            Mes prospects
          </FilterChip>
        )}
        <FilterChip
          pressed={pendingCampaign}
          onClick={() => {
            update({
              pendingCampaign: !pendingCampaign,
              campaign: "",
              sourceFilter: "",
              stage: "",
            });
          }}
        >
          À attribuer{pending.data ? ` (${pending.data.total})` : ""}
        </FilterChip>
        <span className="flex-1" />
        <span className="font-mono text-[13px] text-muted tabular-nums" aria-live="polite">
          {!loading && data
            ? `${data.total} prospect${data.total > 1 ? "s" : ""}`
            : "Chargement…"}
        </span>
        {user && user.role !== "VIEWER" && (
          <Btn
            size="sm"
            variant="outline"
            onClick={async () => {
              setExportError(null);
              try {
                await download(
                  `/prospects/export${qs({ q, stage, campaign_id: campaign, source_id: sourceFilter, advisor_id: mine ? user?.id : undefined, pending_campaign: pendingCampaign ? "true" : undefined, target_code: targetCode, level: levelFilter, channel: channelFilter, consent_status: consentFilter, demo: hideDemo ? "exclude" : "all" })}`,
                  "prospects.csv",
                );
              } catch (err) {
                setExportError(
                  err instanceof ApiError ? err.message : "Échec de l’export",
                );
              }
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            Exporter en CSV (Excel)
          </Btn>
        )}
      </section>
      {pendingCampaign && (
        <p className="rounded-lg bg-warning-soft px-5 py-3.5 text-sm text-warning-soft-foreground">
          Ces prospects attendent une campagne et une source. Ouvrez une fiche
          pour les attribuer ; l’agent attend cette attribution avant de
          répondre automatiquement.
        </p>
      )}
      <form className="card card--default gap-4 p-4" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Filtres</h2>
          {activeFilterCount > 0 && (
            <Tag tone="accent">
              {activeFilterCount} actif{activeFilterCount > 1 ? "s" : ""}
            </Tag>
          )}
          <span className="flex-1" />
          <Btn variant="ghost" size="sm" onClick={reset} className="text-link">
            Réinitialiser
          </Btn>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Rechercher" className="min-w-[200px] flex-[2_1_200px]">
            <TextInput
              type="search"
              placeholder="Nom, email…"
              value={q}
              onChange={(e) => {
                update({ q: e.target.value }, true);
              }}
            />
          </Field>
          <SelectInput
            id="stage-filter"
            label="Étape"
            className="min-w-[160px] flex-[1_1_160px]"
            value={stage}
            onChange={(value) => update({ stage: value })}
            options={[
              { value: "", label: "Toutes les étapes" },
              ...Object.entries(STAGES).map(([value, text]) => ({ value, label: text })),
            ]}
          />
          <SelectInput
            id="campaign-filter"
            label="Campagne"
            className="min-w-[160px] flex-[1_1_160px]"
            value={campaign}
            disabled={campaigns.loading || !!campaigns.error}
            onChange={(value) => update({ campaign: value, sourceFilter: "" })}
            options={[
              { value: "", label: "Toutes" },
              ...(campaigns.data?.items.map((c) => ({
                value: String(c.id),
                label: c.name,
              })) ?? []),
            ]}
          />
          <SelectInput
            id="source-filter"
            label="Source"
            className="min-w-[160px] flex-[1_1_160px]"
            value={sourceFilter}
            disabled={!campaign || campaigns.loading || !!campaigns.error}
            onChange={(value) => update({ sourceFilter: value })}
            options={[
              { value: "", label: campaign ? "Toutes" : "Campagne d’abord" },
              ...(campaigns.data?.items
                .find((c) => c.id === Number(campaign))
                ?.sources?.map((s) => ({ value: String(s.id), label: s.name })) ?? []),
            ]}
          />
          <Btn
            aria-expanded={moreOpen}
            aria-controls="more-filters"
            onClick={() => setMoreOpen(!moreOpen)}
            className={moreOpen ? "bg-accent-soft text-accent-soft-foreground" : undefined}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Plus de filtres
            {activeAdvanced.length > 0 && (
              <span
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-medium text-accent-foreground"
                aria-label={`${activeAdvanced.length} actif${activeAdvanced.length > 1 ? "s" : ""}`}
              >
                {activeAdvanced.length}
              </span>
            )}
          </Btn>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Check
            checked={hideDemo}
            onChange={(value) => {
              update({ hideDemo: value });
            }}
          >
            Masquer les prospects fictifs
          </Check>
        </div>
        {moreOpen && (
          <div className="grid grid-cols-1 gap-3 border-t border-separator pt-4 sm:grid-cols-2 xl:grid-cols-4" id="more-filters">
            {advanced.map((f) => (
              <SelectInput
                key={f.id}
                id={f.id}
                label={f.title}
                value={f.value}
                onChange={f.set}
                options={[
                  { value: "", label: f.all },
                  ...Object.entries(f.options).map(([value, text]) => ({
                    value,
                    label: text,
                  })),
                ]}
              />
            ))}
          </div>
        )}
        {!moreOpen && activeAdvanced.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Filtres actifs">
            {activeAdvanced.map((f) => (
              <button
                type="button"
                key={f.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-default pr-2 pl-3 text-[13px] font-medium text-foreground outline-none hover:bg-default-hover focus-visible:ring-2 focus-visible:ring-focus"
                aria-label={`Retirer le filtre ${f.title}`}
                onClick={() => {
                  f.set("");
                }}
              >
                {f.title} : {label(f.options, f.value)}
                <X className="size-3.5 text-muted" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </form>
      {exportError && <ErrorText>{exportError}</ErrorText>}
      {campaigns.error && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-danger-soft-foreground">
            Filtre campagnes indisponible : {campaigns.error.message}
          </p>
          <Btn size="sm" onClick={campaigns.reload}>Réessayer les campagnes</Btn>
        </div>
      )}
      <Loading loading={loading} error={error} onRetry={reload} shape="rows" />
      {!loading && data && (
        <>
          {data.items.length === 0 ? (
            <section className="card card--default p-0">
              <EmptyPanel
                icon={SearchX}
                title="Aucun prospect ne correspond"
                description="Essayez une autre recherche ou réinitialisez les filtres."
                action={<Btn onClick={reset}>Réinitialiser les filtres</Btn>}
              />
            </section>
          ) : (
            <>
              {view === "pipeline" ? (
                <>
                  <p className="text-[13px] text-muted">
                    {data.total > data.items.length
                      ? `${data.items.length} prospect${data.items.length > 1 ? "s" : ""} affiché${data.items.length > 1 ? "s" : ""} sur ${data.total}. Affinez les filtres ou utilisez la vue Table pour parcourir l’ensemble.`
                      : `${data.total} prospect${data.total > 1 ? "s" : ""}.`}{" "}
                    Faites défiler horizontalement pour parcourir les étapes.
                  </p>
                  <PipelineScroller>
                    {columns.map((column) => {
                      const { key, title } = column;
                      const items = data.items.filter((p) =>
                        inColumn(p, column),
                      );
                      return (
                        <section
                          className={`flex w-[272px] shrink-0 snap-start flex-col gap-2 rounded-lg p-2 ${key === "exit" ? "bg-surface-tertiary/60" : "bg-surface-secondary"}`}
                          key={key}
                          aria-label={title}
                        >
                          <header className="flex items-center gap-2 px-2 py-1.5">
                            <h2 className="flex-1 text-sm font-semibold text-foreground">{title}</h2>
                            <span className="rounded-md bg-surface px-1.5 font-mono text-xs text-muted tabular-nums">{items.length}</span>
                          </header>
                          {items.map((p) => (
                            <Link
                              className="pipeline-card flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-surface outline-none transition-shadow duration-150 hover:shadow-overlay focus-visible:ring-2 focus-visible:ring-focus"
                              key={p.id}
                              href={profileHref(p.id)}
                            >
                              <div className="flex items-center gap-2">
                                <Avatar prospect={p} />
                                <strong className="min-w-0 flex-1 text-[13px] font-semibold break-words text-foreground">{fullName(p)}</strong>
                                <DemoBadge email={p.email} />
                              </div>
                              <span className="text-xs break-all text-muted">
                                {p.email ||
                                  p.phone ||
                                  "Coordonnées non renseignées"}
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {membershipsOf(p)
                                  .filter((m) =>
                                    column.stages.includes(m.conversion_stage),
                                  )
                                  .map((m) => (
                                    <span key={m.id} className="flex min-w-0 flex-col gap-1">
                                      <span className="truncate text-xs font-medium text-foreground">
                                        {m.campaign_name ?? "Campagne"}
                                      </span>
                                      <span className="flex flex-wrap gap-1.5">
                                        <StageBadge stage={m.conversion_stage} />
                                        <ScoreBadge
                                          total={m.total_score}
                                          level={level(m.total_score)}
                                        />
                                      </span>
                                    </span>
                                  ))}
                                <ConsentTag status={p.consent_status} />
                              </div>
                              <span className="text-xs text-muted">
                                Créé le {formatDate(p.created_at)}
                              </span>
                            </Link>
                          ))}
                          {!items.length && (
                            <p
                              className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted"
                              title={
                                data.total > data.items.length
                                  ? "Aucun parmi les prospects affichés sur cette page"
                                  : "Aucun prospect à cette étape"
                              }
                            >
                              Aucun
                            </p>
                          )}
                        </section>
                      );
                    })}
                  </PipelineScroller>
                </>
              ) : (
                <div className="overflow-x-auto rounded-lg bg-surface shadow-surface" role="region" tabIndex={0} aria-label="Tableau des prospects">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <caption className="sr-only">
                      Prospects et rattachements aux campagnes
                    </caption>
                    <thead className="sticky top-0 z-10 bg-surface-secondary text-left text-xs font-medium text-muted">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 font-medium">Prospect</th>
                        <th scope="col" className="px-4 py-2.5 font-medium">Étapes et scores</th>
                        <th scope="col" className="px-4 py-2.5 font-medium">Consentement</th>
                        <th scope="col" className="px-4 py-2.5 font-medium">Créé le</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id} className="border-t border-separator transition-colors hover:bg-surface-secondary/60">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar prospect={p} />
                              <div className="flex min-w-0 flex-col">
                                <span className="flex flex-wrap items-center gap-2">
                                  <Link href={profileHref(p.id)} className="rounded font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus">
                                    {fullName(p)}
                                  </Link>
                                  <DemoBadge email={p.email} />
                                </span>
                                <span className="text-xs text-muted">
                                  {p.email || p.phone || "—"}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {membershipsOf(p).length ? (
                              <div className="flex flex-col gap-1.5">
                                {membershipsOf(p).map((m) => (
                                  <div key={m.id} className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-foreground">
                                      {m.campaign_name ?? "Campagne"}
                                    </span>
                                    <span className="flex flex-wrap gap-1.5">
                                      <StageBadge stage={m.conversion_stage} />
                                      <ScoreBadge
                                        total={m.total_score}
                                        level={level(m.total_score)}
                                      />
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[13px] text-muted">Sans campagne</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <ConsentTag status={p.consent_status} />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted tabular-nums">
                            {formatDate(p.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <Pager
            total={data.total}
            limit={data.limit}
            offset={data.offset}
            onChange={(offset) => update({ offset })}
          />
        </>
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
