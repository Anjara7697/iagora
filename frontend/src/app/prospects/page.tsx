"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  DemoBadge,
  Loading,
  Pager,
  ScoreBadge,
  StageBadge,
} from "@/components/ui";
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
function Avatar({ prospect }: { prospect: Prospect }) {
  return (
    <span className="prospect-avatar" aria-hidden="true">
      {[prospect.first_name, prospect.last_name]
        .filter(Boolean)
        .map((s) => s![0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "?"}
    </span>
  );
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
    <div
      className={`pipeline-scroller ${edges.left ? "more-left" : ""} ${edges.right ? "more-right" : ""}`}
    >
      <div
        ref={ref}
        className="pipeline"
        tabIndex={0}
        role="region"
        aria-label="Pipeline des prospects, défilement horizontal"
      >
        {children}
      </div>
      {edges.left && (
        <button
          type="button"
          className="pipeline-nav prev"
          aria-label="Étapes précédentes"
          onClick={() => scroll(-1)}
        >
          ‹
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          className="pipeline-nav next"
          aria-label="Étapes suivantes"
          onClick={() => scroll(1)}
        >
          ›
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
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Travail · Suivi commercial</span>
          <h1>Prospects</h1>
          <p className="muted">
            Un parcours, des échanges et une prochaine étape pour chaque
            prospect.
          </p>
        </div>
        {user && user.role !== "VIEWER" && (
          <Link href="/prospects/import" className="primary-link">
            Importer un CSV
          </Link>
        )}
      </div>
      <div className="view-toolbar">
        {user && user.role !== "VIEWER" && (
          <button
            aria-pressed={mine}
            onClick={() => {
              update({ mine: !mine });
            }}
          >
            Mes prospects
          </button>
        )}
        <button
          aria-pressed={pendingCampaign}
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
        </button>

        <div
          className="view-switch"
          role="group"
          aria-label="Affichage des prospects"
        >
          <button
            aria-pressed={view === "pipeline"}
            onClick={() => {
              update({ view: "pipeline" });
            }}
          >
            Pipeline
          </button>
          <button
            aria-pressed={view === "table"}
            onClick={() => {
              update({ view: "table" });
            }}
          >
            Table
          </button>
        </div>
        <span className="spacer" />
        {user && user.role !== "VIEWER" && (
          <button
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
            Exporter en CSV (Excel)
          </button>
        )}
        <span className="muted" aria-live="polite">
          {!loading && data
            ? `${data.total} prospect${data.total > 1 ? "s" : ""}`
            : "Chargement…"}
        </span>
      </div>
      {pendingCampaign && (
        <p className="card warnbox">
          Ces prospects attendent une campagne et une source. Ouvrez une fiche
          pour les attribuer ; l’agent attend cette attribution avant de
          répondre automatiquement.
        </p>
      )}
      <form className="filters card" onSubmit={(e) => e.preventDefault()}>
        <label>
          Rechercher
          <input
            type="search"
            placeholder="Nom, email…"
            value={q}
            onChange={(e) => {
              update({ q: e.target.value }, true);
            }}
          />
        </label>
        <div className="filter-field">
          <label htmlFor="stage-filter">Étape</label>
          <select
            id="stage-filter"
            value={stage}
            onChange={(e) => {
              update({ stage: e.target.value });
            }}
          >
            <option value="">Toutes les étapes</option>
            {Object.entries(STAGES).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="campaign-filter">Campagne</label>
          <select
            id="campaign-filter"
            value={campaign}
            disabled={campaigns.loading || !!campaigns.error}
            onChange={(e) => {
              update({ campaign: e.target.value, sourceFilter: "" });
            }}
          >
            <option value="">Toutes les campagnes</option>
            {campaigns.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="source-filter">Source</label>
          <select
            id="source-filter"
            value={sourceFilter}
            disabled={!campaign || campaigns.loading || !!campaigns.error}
            onChange={(e) => {
              update({ sourceFilter: e.target.value });
            }}
          >
            <option value="">
              {campaign ? "Toutes les sources" : "Choisir d’abord une campagne"}
            </option>
            {campaigns.data?.items
              .find((c) => c.id === Number(campaign))
              ?.sources?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <button
          type="button"
          className="filters-more"
          aria-expanded={moreOpen}
          aria-controls="more-filters"
          onClick={() => setMoreOpen(!moreOpen)}
        >
          Plus de filtres
          {activeAdvanced.length > 0 && (
            <span
              className="filters-count"
              aria-label={`${activeAdvanced.length} actif${activeAdvanced.length > 1 ? "s" : ""}`}
            >
              {activeAdvanced.length}
            </span>
          )}
        </button>
        <label className="inline-field">
          <input
            type="checkbox"
            checked={hideDemo}
            onChange={(e) => {
              update({ hideDemo: e.target.checked });
            }}
          />
          Masquer les prospects fictifs
        </label>
        <button type="button" className="filters-reset" onClick={reset}>
          Réinitialiser
        </button>
        {moreOpen && (
          <div className="filters-advanced" id="more-filters">
            {advanced.map((f) => (
              <div className="filter-field" key={f.id}>
                <label htmlFor={f.id}>{f.title}</label>
                <select
                  id={f.id}
                  value={f.value}
                  onChange={(e) => {
                    f.set(e.target.value);
                  }}
                >
                  <option value="">{f.all}</option>
                  {Object.entries(f.options).map(([key, text]) => (
                    <option key={key} value={key}>
                      {text}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        {!moreOpen && activeAdvanced.length > 0 && (
          <div className="filters-chips" aria-label="Filtres actifs">
            {activeAdvanced.map((f) => (
              <button
                type="button"
                key={f.id}
                className="filter-chip"
                aria-label={`Retirer le filtre ${f.title}`}
                onClick={() => {
                  f.set("");
                }}
              >
                {f.title} : {label(f.options, f.value)}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}
      </form>
      {exportError && (
        <p className="error" role="alert">
          {exportError}
        </p>
      )}
      {campaigns.error && (
        <div className="row">
          <p role="alert" className="error">
            Filtre campagnes indisponible : {campaigns.error.message}
          </p>
          <button onClick={campaigns.reload}>Réessayer les campagnes</button>
        </div>
      )}
      <Loading loading={loading} error={error} onRetry={reload} />
      {!loading && data && (
        <>
          {data.items.length === 0 ? (
            <section className="empty-state">
              <h2>Aucun prospect ne correspond</h2>
              <p className="muted">
                Essayez une autre recherche ou réinitialisez les filtres.
              </p>
              <button onClick={reset}>Réinitialiser les filtres</button>
            </section>
          ) : (
            <>
              {view === "pipeline" ? (
                <>
                  <p className="muted pipeline-note">
                    {data.total > data.items.length
                      ? `${data.items.length} prospect${data.items.length > 1 ? "s" : ""} affiché${data.items.length > 1 ? "s" : ""} sur ${data.total} : affinez les filtres ou passez en vue Table pour tout parcourir.`
                      : `${data.total} prospect${data.total > 1 ? "s" : ""}.`}{" "}
                    Un prospect suivi dans plusieurs campagnes apparaît dans
                    chaque colonne concernée. Faites défiler vers la droite pour
                    voir toutes les étapes.
                  </p>
                  <PipelineScroller>
                    {columns.map((column) => {
                      const { key, title } = column;
                      const items = data.items.filter((p) =>
                        inColumn(p, column),
                      );
                      return (
                        <section
                          className={`pipeline-column ${key === "exit" ? "exits" : ""}`}
                          key={key}
                          aria-label={title}
                        >
                          <header>
                            <h2>{title}</h2>
                            <span className="mono">{items.length}</span>
                          </header>
                          {items.map((p) => (
                            <Link
                              className="pipeline-card"
                              key={p.id}
                              href={profileHref(p.id)}
                            >
                              <div className="row">
                                <Avatar prospect={p} />
                                <strong>{fullName(p)}</strong>
                                <DemoBadge email={p.email} />
                              </div>
                              <span className="muted">
                                {p.email ||
                                  p.phone ||
                                  "Coordonnées non renseignées"}
                              </span>
                              <div className="row">
                                {membershipsOf(p)
                                  .filter((m) =>
                                    column.stages.includes(m.conversion_stage),
                                  )
                                  .map((m) => (
                                    <span key={m.id} className="row">
                                      <StageBadge stage={m.conversion_stage} />
                                      <ScoreBadge
                                        total={m.total_score}
                                        level={level(m.total_score)}
                                      />
                                    </span>
                                  ))}
                                <span
                                  className={`badge consent-${p.consent_status}`}
                                >
                                  {label(CONSENT, p.consent_status)}
                                </span>
                              </div>
                              <span className="mono muted">
                                Créé le {formatDate(p.created_at)}
                              </span>
                            </Link>
                          ))}
                          {!items.length && (
                            <p className="muted pipeline-empty">
                              {data.total > data.items.length
                                ? "Aucun parmi les prospects affichés."
                                : "Aucun prospect à cette étape."}
                            </p>
                          )}
                        </section>
                      );
                    })}
                  </PipelineScroller>
                </>
              ) : (
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">
                      Prospects et rattachements aux campagnes
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Prospect</th>
                        <th scope="col">Étapes et scores</th>
                        <th scope="col">Consentement</th>
                        <th scope="col">Créé le</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="row">
                              <Avatar prospect={p} />
                              <div>
                                <Link href={profileHref(p.id)}>
                                  {fullName(p)}
                                </Link>{" "}
                                <DemoBadge email={p.email} />
                                <div className="muted">
                                  {p.email || p.phone || "—"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            {membershipsOf(p).length ? (
                              membershipsOf(p).map((m) => (
                                <div key={m.id} className="row">
                                  <StageBadge stage={m.conversion_stage} />
                                  <ScoreBadge
                                    total={m.total_score}
                                    level={level(m.total_score)}
                                  />
                                </div>
                              ))
                            ) : (
                              <span className="muted">Sans campagne</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`badge consent-${p.consent_status}`}
                            >
                              {label(CONSENT, p.consent_status)}
                            </span>
                          </td>
                          <td className="mono muted">
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
    </>
  );
}

export default function ProspectsPage() {
  return (
    <Suspense fallback={<p className="muted">Chargement…</p>}>
      <Prospects />
    </Suspense>
  );
}
