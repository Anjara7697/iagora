"use client";

import Link from "next/link";
import { useState } from "react";
import { Loading, Pager, ProspectLink, ScoreBadge, StageBadge } from "@/components/ui";
import { formatDate, fullName, label, CONSENT, STAGES } from "@/lib/labels";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Campaign, Page, Prospect } from "@/lib/types";

const LIMIT = 25;
const PIPELINE_COLUMNS = [
  { key: "unassigned", title: "Sans campagne", stages: [] as string[] },
  { key: "new", title: "À qualifier", stages: ["new", "to_qualify"] },
  { key: "conversation", title: "En échange", stages: ["contacted", "in_conversation"] },
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
const level = (t: number) => (t >= 75 ? "very_hot" : t >= 50 ? "hot" : t >= 25 ? "warm" : "cold");
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

export default function ProspectsPage() {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [campaign, setCampaign] = useState("");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<"pipeline" | "table">("pipeline");
  const { data, error, loading, reload } = useApi<Page<Prospect>>(
    `/prospects${qs({ q, stage, campaign_id: campaign, limit: LIMIT, offset })}`,
  );
  const campaigns = useApi<Page<Campaign>>("/campaigns?limit=200");
  function reset() {
    setQ("");
    setStage("");
    setCampaign("");
    setOffset(0);
  }
  const columns = PIPELINE_COLUMNS.filter(
    (column) =>
      (!stage || column.stages.includes(stage) || column.key === "exit") &&
      (column.key !== "unassigned" || data?.items.some((p) => p.campaigns.length === 0)),
  );
  function inColumn(p: Prospect, column: (typeof PIPELINE_COLUMNS)[number]) {
    if (column.key === "exit")
      return (
        p.consent_status === "opted_out" || p.campaigns.some((m) => m.conversion_stage === "lost")
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
            Un parcours, des échanges et une prochaine étape pour chaque prospect.
          </p>
        </div>
      </div>
      <div className="view-toolbar">
        <div className="view-switch" role="group" aria-label="Affichage des prospects">
          <button aria-pressed={view === "pipeline"} onClick={() => setView("pipeline")}>
            Pipeline
          </button>
          <button aria-pressed={view === "table"} onClick={() => setView("table")}>
            Table
          </button>
        </div>
        <span className="spacer" />
        <span className="muted" aria-live="polite">
          {!loading && data ? `${data.total} prospect${data.total > 1 ? "s" : ""}` : "Chargement…"}
        </span>
      </div>
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
        <button type="button" onClick={reset}>
          Réinitialiser
        </button>
      </form>
      {campaigns.error && (
        <div className="row">
          <p role="alert" className="error">
            Filtre campagnes indisponible : {campaigns.error.message}
          </p>
          <button onClick={campaigns.reload}>Réessayer les campagnes</button>
        </div>
      )}
      <Loading loading={loading} error={error} />
      {error && <button onClick={reload}>Réessayer</button>}
      {!loading && data && (
        <>
          {data.items.length === 0 ? (
            <section className="empty-state">
              <h2>Aucun prospect ne correspond</h2>
              <p className="muted">Essayez une autre recherche ou réinitialisez les filtres.</p>
              <button onClick={reset}>Réinitialiser les filtres</button>
            </section>
          ) : (
            <>
              {view === "pipeline" ? (
                <>
                  <p className="muted pipeline-note">
                    Cette page affiche {data.items.length} prospect
                    {data.items.length > 1 ? "s" : ""} sur {data.total}. Les colonnes regroupent les
                    étapes ; un prospect peut apparaître dans plusieurs colonnes.
                  </p>
                  <div
                    className="pipeline"
                    tabIndex={0}
                    role="region"
                    aria-label="Pipeline des prospects, défilement horizontal"
                  >
                    {columns.map((column) => {
                      const { key, title } = column;
                      const items = data.items.filter((p) => inColumn(p, column));
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
                            <Link className="pipeline-card" key={p.id} href={`/prospects/${p.id}`}>
                              <div className="row">
                                <Avatar prospect={p} />
                                <strong>{fullName(p)}</strong>
                              </div>
                              <span className="muted">
                                {p.email || p.phone || "Coordonnées non renseignées"}
                              </span>
                              <div className="row">
                                {p.campaigns
                                  .filter((m) => column.stages.includes(m.conversion_stage))
                                  .map((m) => (
                                    <span key={m.id} className="row">
                                      <StageBadge stage={m.conversion_stage} />
                                      <ScoreBadge
                                        total={m.total_score}
                                        level={level(m.total_score)}
                                      />
                                    </span>
                                  ))}
                                <span className={`badge consent-${p.consent_status}`}>
                                  {label(CONSENT, p.consent_status)}
                                </span>
                              </div>
                              <span className="mono muted">Créé le {formatDate(p.created_at)}</span>
                            </Link>
                          ))}
                          {!items.length && <p className="muted">Aucun prospect sur cette page.</p>}
                        </section>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Prospects et rattachements aux campagnes</caption>
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
                                <ProspectLink id={p.id}>{fullName(p)}</ProspectLink>
                                <div className="muted">{p.email || p.phone || "—"}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            {p.campaigns.length ? (
                              p.campaigns.map((m) => (
                                <div key={m.id} className="row">
                                  <StageBadge stage={m.conversion_stage} />
                                  <ScoreBadge total={m.total_score} level={level(m.total_score)} />
                                </div>
                              ))
                            ) : (
                              <span className="muted">Sans campagne</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge consent-${p.consent_status}`}>
                              {label(CONSENT, p.consent_status)}
                            </span>
                          </td>
                          <td className="mono muted">{formatDate(p.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />
        </>
      )}
    </>
  );
}
