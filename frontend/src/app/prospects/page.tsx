"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  DemoBadge,
  Loading,
  Pager,
  ProspectLink,
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
import type { Campaign, Page, Prospect } from "@/lib/types";

const LIMIT = 25;
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

function Prospects() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pendingCampaign, setPendingCampaign] = useState(
    params.get("pending_campaign") === "true",
  );
  const pending = useApi<Page<Prospect>>(
    "/prospects?pending_campaign=true&limit=1",
  );
  const [stage, setStage] = useState("");
  const [campaign, setCampaign] = useState(params.get("campaign") ?? "");
  const [offset, setOffset] = useState(0);
  const [hideDemo, setHideDemo] = useState(false);
  const [targetCode, setTargetCode] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [consentFilter, setConsentFilter] = useState("");
  const [mine, setMine] = useState(false);
  const user = useCurrentUser();
  const [exportError, setExportError] = useState<string | null>(null);
  const [view, setView] = useState<"pipeline" | "table">("pipeline");
  const { data, error, loading, reload } = useApi<Page<Prospect>>(
    `/prospects${qs({ q, stage, campaign_id: campaign, advisor_id: mine ? user?.id : undefined, pending_campaign: pendingCampaign ? "true" : undefined, demo: hideDemo ? "exclude" : undefined, target_code: targetCode, level: levelFilter, channel: channelFilter, consent_status: consentFilter, limit: LIMIT, offset })}`,
    { keepPrevious: true },
  );
  const campaigns = useApi<Page<Campaign>>("/campaigns?limit=200");
  function reset() {
    setQ("");
    setStage("");
    setPendingCampaign(false);
    setCampaign("");
    setHideDemo(false);
    setTargetCode("");
    setLevelFilter("");
    setChannelFilter("");
    setConsentFilter("");
    setMine(false);
    setOffset(0);
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
        p.campaigns.some((m) => m.conversion_stage === "lost")
      );
    if (p.consent_status === "opted_out") return false;
    if (column.key === "unassigned") return p.campaigns.length === 0;
    return p.campaigns.some((m) => column.stages.includes(m.conversion_stage));
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
      </div>
      <div className="view-toolbar">
        {user && user.role !== "VIEWER" && (
          <button
            aria-pressed={mine}
            onClick={() => {
              setMine(!mine);
              setOffset(0);
            }}
          >
            Mes prospects
          </button>
        )}
        <button
          aria-pressed={pendingCampaign}
          onClick={() => {
            setPendingCampaign(!pendingCampaign);
            setCampaign("");
            setStage("");
            setOffset(0);
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
            onClick={() => setView("pipeline")}
          >
            Pipeline
          </button>
          <button
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
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
                  `/prospects/export${qs({ q, stage, campaign_id: campaign, advisor_id: mine ? user?.id : undefined, pending_campaign: pendingCampaign ? "true" : undefined, target_code: targetCode, level: levelFilter, channel: channelFilter, consent_status: consentFilter, demo: hideDemo ? "exclude" : "all" })}`,
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
              setQ(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <div className="filter-field">
          <label htmlFor="stage-filter">Étape</label>
          <select
            id="stage-filter"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setOffset(0);
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
              setCampaign(e.target.value);
              setOffset(0);
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
        {[
          [
            "Programme",
            "target-filter",
            targetCode,
            setTargetCode,
            TARGETS,
            "Tous les programmes",
          ],
          [
            "Intérêt",
            "level-filter",
            levelFilter,
            setLevelFilter,
            LEVELS,
            "Tous les niveaux",
          ],
          [
            "Canal",
            "channel-filter",
            channelFilter,
            setChannelFilter,
            CHANNELS,
            "Tous les canaux",
          ],
          [
            "Consentement",
            "consent-filter",
            consentFilter,
            setConsentFilter,
            CONSENT,
            "Tous",
          ],
        ].map(([title, id, value, setter, options, all]) => (
          <div className="filter-field" key={id as string}>
            <label htmlFor={id as string}>{title as string}</label>
            <select
              id={id as string}
              value={value as string}
              onChange={(e) => {
                (setter as (v: string) => void)(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">{all as string}</option>
              {Object.entries(options as Record<string, string>).map(
                ([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ),
              )}
            </select>
          </div>
        ))}
        <label className="inline-field">
          <input
            type="checkbox"
            checked={hideDemo}
            onChange={(e) => {
              setHideDemo(e.target.checked);
              setOffset(0);
            }}
          />
          Masquer les prospects fictifs
        </label>
        <button type="button" onClick={reset}>
          Réinitialiser
        </button>
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
                    Cette page affiche {data.items.length} prospect
                    {data.items.length > 1 ? "s" : ""} sur {data.total}. Les
                    colonnes regroupent les étapes ; un prospect peut apparaître
                    dans plusieurs colonnes.
                  </p>
                  <div
                    className="pipeline"
                    tabIndex={0}
                    role="region"
                    aria-label="Pipeline des prospects, défilement horizontal"
                  >
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
                              href={`/prospects/${p.id}`}
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
                                {p.campaigns
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
                            <p className="muted">
                              Aucun prospect sur cette page.
                            </p>
                          )}
                        </section>
                      );
                    })}
                  </div>
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
                                <ProspectLink id={p.id}>
                                  {fullName(p)}
                                </ProspectLink>{" "}
                                <DemoBadge email={p.email} />
                                <div className="muted">
                                  {p.email || p.phone || "—"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            {p.campaigns.length ? (
                              p.campaigns.map((m) => (
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
            onChange={setOffset}
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
