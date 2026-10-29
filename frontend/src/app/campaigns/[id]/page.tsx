"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import CampaignForm, { type CampaignValues } from "@/components/CampaignForm";
import CampaignOwnership from "@/components/CampaignOwnership";
import { useCurrentUser } from "@/components/AppShell";
import {
  DemoBadge,
  Loading,
  Pager,
  ScoreBadge,
  StageBadge,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  CAMPAIGN_STATUS,
  CONSENT,
  FUNNEL,
  STAGES,
  fullName,
  LEVELS,
  PLATFORMS,
  SOURCE_TYPES,
  TARGETS,
  formatDay,
  label,
} from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import { qs } from "@/lib/api";
import type {
  Campaign,
  CampaignStats,
  Page,
  Prospect,
  Target,
} from "@/lib/types";

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const toIso = (value: string) => (value ? `${value}T00:00:00Z` : null);

function Bar({
  title,
  value,
  max,
  tone,
}: {
  title: string;
  value: number;
  max: number;
  /** Couleur de la barre (niveau d'intérêt), sinon couleur d'accent. */
  tone?: string;
}) {
  return (
    <div className="bar-row">
      <span>{title}</span>
      <div className={`bar ${tone ? `bar-${tone}` : ""}`} aria-hidden="true">
        <div
          style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }}
        />
      </div>
      <span className="mono">{value}</span>
    </div>
  );
}

function Funnel({ stats }: { stats: CampaignStats }) {
  const rows = FUNNEL.map((step) => ({
    title: step.title,
    value: step.stages.reduce((sum, s) => sum + (stats.by_stage[s] ?? 0), 0),
  }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="ui-card" aria-label="Entonnoir">
      <h3>Entonnoir</h3>
      {stats.prospects === 0 ? (
        <p className="muted">Aucun prospect pour l&apos;instant.</p>
      ) : (
        rows.map((r) => <Bar key={r.title} {...r} max={max} />)
      )}
    </section>
  );
}

function Levels({ stats }: { stats: CampaignStats }) {
  const order = ["very_hot", "hot", "warm", "cold", "none"];
  const max = Math.max(1, ...order.map((k) => stats.by_level[k] ?? 0));
  return (
    <section className="ui-card" aria-label="Niveaux d'intérêt">
      <h3>Niveaux d&apos;intérêt</h3>
      {order.map((k) => (
        <Bar
          key={k}
          title={k === "none" ? "Non évalué" : label(LEVELS, k)}
          value={stats.by_level[k] ?? 0}
          max={max}
          tone={`level-${k}`}
        />
      ))}
    </section>
  );
}

function Sources({
  campaign,
  stats,
  canEdit,
  onChanged,
}: {
  campaign: Campaign;
  stats: CampaignStats | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({
    name: "",
    type: "ads",
    platform: "linkedin",
    external_id: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = new Map(
    (stats?.by_source ?? []).map((s) => [s.source_id, s.prospects]),
  );

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ui-card" aria-label="Sources">
      <h3>Sources de prospects</h3>
      {campaign.sources.length === 0 ? (
        <p className="muted">
          Aucune source rattachée : aucun prospect ne peut entrer dans cette
          campagne.
        </p>
      ) : (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Sources de la campagne, défilement horizontal"
        >
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Plateforme</th>
                <th>Type</th>
                <th>Prospects</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {campaign.sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{label(PLATFORMS, s.platform)}</td>
                  <td>{label(SOURCE_TYPES, s.type)}</td>
                  <td>{counts.get(s.id) ?? 0}</td>
                  <td>
                    {canEdit && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            api(`/campaigns/${campaign.id}/sources/${s.id}`, {
                              method: "DELETE",
                            }),
                          )
                        }
                      >
                        Retirer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {canEdit && (
        <div className="source-row">
          <input
            aria-label="Nom de la nouvelle source"
            placeholder="Nouvelle source (ex. Webinaire d'octobre)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <select
            aria-label="Type de la nouvelle source"
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          >
            {Object.entries(SOURCE_TYPES).map(([k, text]) => (
              <option key={k} value={k}>
                {text}
              </option>
            ))}
          </select>
          <select
            aria-label="Plateforme de la nouvelle source"
            value={draft.platform}
            onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
          >
            {Object.entries(PLATFORMS).map(([k, text]) => (
              <option key={k} value={k}>
                {text}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={busy || !draft.name.trim()}
            onClick={() =>
              act(async () => {
                await api(`/campaigns/${campaign.id}/sources`, {
                  method: "POST",
                  body: {
                    name: draft.name.trim(),
                    type: draft.type,
                    platform: draft.platform,
                    external_id: draft.external_id.trim() || null,
                  },
                });
                setDraft({ ...draft, name: "" });
              })
            }
          >
            Ajouter
          </button>
        </div>
      )}
    </section>
  );
}

const PROSPECTS_LIMIT = 10;

/** Prospects rattachés à la campagne : nom, étape dans CETTE campagne, score, consentement. */
function CampaignProspects({ campaign }: { campaign: Campaign }) {
  const [stage, setStage] = useState("");
  const [offset, setOffset] = useState(0);
  const list = useApi<Page<Prospect>>(
    `/prospects${qs({ campaign_id: campaign.id, stage, limit: PROSPECTS_LIMIT, offset })}`,
    { keepPrevious: true },
  );
  const items = list.data?.items ?? [];
  return (
    <section className="ui-card" aria-label="Prospects de la campagne">
      <div className="row">
        <h3>Prospects de la campagne</h3>
        <span className="spacer" />
        <label className="inline-field">
          Étape
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Toutes</option>
            {Object.entries(STAGES).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Loading
        loading={list.loading && !list.data}
        error={list.error}
        onRetry={list.reload}
      />
      {list.data && items.length === 0 && (
        <p className="muted">
          {stage
            ? "Aucun prospect à cette étape."
            : "Aucun prospect pour l’instant. Ils arrivent par les sources de la campagne."}
        </p>
      )}
      {items.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Prospects de la campagne</caption>
            <thead>
              <tr>
                <th scope="col">Prospect</th>
                <th scope="col">Étape</th>
                <th scope="col">Score</th>
                <th scope="col">Consentement</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const m = p.campaigns
                  .filter((c) => c.campaign_id === campaign.id)
                  .sort(
                    (a, b) =>
                      new Date(b.last_seen_at ?? 0).getTime() -
                        new Date(a.last_seen_at ?? 0).getTime() || b.id - a.id,
                  )[0];
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/prospects/${p.id}`}>
                        {fullName(p) || p.email || `#${p.id}`}
                      </Link>{" "}
                      <DemoBadge email={p.email} />
                      {p.email && <div className="muted">{p.email}</div>}
                    </td>
                    <td>
                      {m ? <StageBadge stage={m.conversion_stage} /> : "-"}
                    </td>
                    <td>
                      {m ? (
                        <ScoreBadge
                          total={m.total_score}
                          level={m.interest_status}
                        />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{label(CONSENT, p.consent_status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.data && list.data.total > PROSPECTS_LIMIT && (
        <Pager
          total={list.data.total}
          limit={PROSPECTS_LIMIT}
          offset={offset}
          onChange={setOffset}
        />
      )}
    </section>
  );
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const user = useCurrentUser();
  const canEdit = user?.role === "ADMIN";
  const campaign = useApi<Campaign>(`/campaigns/${id}`);
  const stats = useApi<CampaignStats>(`/campaigns/${id}/stats`);
  const targets = useApi<Target[]>(canEdit ? "/targets" : null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const c = campaign.data;
  const reload = () => {
    campaign.reload();
    stats.reload();
  };

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/campaigns/${id}`, { method: "PATCH", body });
      setEditing(false);
      reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Échec de l'enregistrement",
      );
    } finally {
      setBusy(false);
    }
  }

  const save = (v: CampaignValues) =>
    patch({
      name: v.name.trim(),
      description: v.description.trim() || null,
      status: v.status,
      start_date: toIso(v.start_date),
      end_date: toIso(v.end_date),
      target_codes: v.target_codes,
    });

  return (
    <>
      <p>
        <Link href="/campaigns">← Campagnes</Link>
      </p>
      <Loading
        loading={campaign.loading}
        error={campaign.error}
        onRetry={campaign.reload}
      />
      {c && (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">Travail · Campagne</span>
              <h1>{c.name}</h1>
              <div className="row">
                <span className={`ui-badge campaign-${c.status}`}>
                  {label(CAMPAIGN_STATUS, c.status)}
                </span>
                <span className="muted">
                  {c.start_date || c.end_date
                    ? `${formatDay(c.start_date)} → ${formatDay(c.end_date)}`
                    : "Sans dates"}
                </span>
              </div>
              {c.description && <p className="muted">{c.description}</p>}
            </div>
            <span className="spacer" />
            <div className="row page-actions">
              {canEdit && !editing && (
                <button
                  disabled={!targets.data}
                  title={targets.error ? "Programmes indisponibles" : undefined}
                  onClick={() => setEditing(true)}
                >
                  Modifier la campagne
                </button>
              )}
              <Link
                className="button-link primary-link"
                href={`/prospects?campaign=${c.id}`}
              >
                Voir les prospects
              </Link>
            </div>
          </div>
          {canEdit && targets.error && (
            <p className="error" role="alert">
              Liste des programmes indisponible : {targets.error.message}{" "}
              <button onClick={targets.reload}>Réessayer</button>
            </p>
          )}
          {error && !editing && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {editing && targets.data && (
            <CampaignForm
              initial={{
                name: c.name,
                description: c.description ?? "",
                status: c.status,
                start_date: day(c.start_date),
                end_date: day(c.end_date),
                target_codes: c.targets.map((t) => t.code),
                sources: [],
              }}
              targets={targets.data}
              withSources={false}
              submitLabel="Enregistrer"
              busy={busy}
              error={error}
              onSubmit={save}
              onCancel={() => setEditing(false)}
            />
          )}

          {stats.error && (
            <p className="error" role="alert">
              Statistiques indisponibles : {stats.error.message}{" "}
              <button onClick={stats.reload}>Réessayer</button>
            </p>
          )}
          {stats.data && (
            <>
              <div className="kpis kpis-wide">
                <div className="kpi">
                  <strong>{stats.data.prospects}</strong>
                  <span className="muted">Prospects</span>
                </div>
                <div className="kpi">
                  <strong>
                    {Math.round(stats.data.average_score * 10) / 10}
                  </strong>
                  <span className="muted">Score moyen</span>
                </div>
                <div className="kpi">
                  <strong>{stats.data.meetings}</strong>
                  <span className="muted">Rendez-vous</span>
                </div>
                <div className="kpi">
                  <strong>{stats.data.converted}</strong>
                  <span className="muted">Convertis</span>
                </div>
              </div>
              <div className="grid2">
                <Funnel stats={stats.data} />
                <Levels stats={stats.data} />
              </div>
            </>
          )}
          <CampaignProspects campaign={c} />

          <section
            className="campaign-settings"
            aria-labelledby="campaign-settings-title"
          >
            <header className="campaign-settings-head">
              <h2 id="campaign-settings-title">Réglages de la campagne</h2>
              <span className="muted">
                {canEdit
                  ? "Responsable, programmes, sources et statut."
                  : "Consultation seule : réservé aux administrateurs."}
              </span>
            </header>
            <CampaignOwnership
              key={`${c.id}:${c.responsible_advisor_id}`}
              campaign={c}
              onDone={campaign.reload}
            />
            <section className="ui-card" aria-label="Programmes visés">
              <h3>Programmes visés</h3>
              <div className="row">
                {c.targets.map((t) => (
                  <span key={t.code} className="ui-badge">
                    {label(TARGETS, t.code)}
                  </span>
                ))}
                {c.targets.length === 0 && (
                  <span className="muted">
                    Aucun programme : modifiez la campagne pour en choisir.
                  </span>
                )}
              </div>
            </section>
            <Sources
              campaign={c}
              stats={stats.data}
              canEdit={canEdit}
              onChanged={reload}
            />
            {canEdit && (
              <section className="ui-card campaign-status" aria-label="Statut">
                <div>
                  <h3>Statut</h3>
                  <p className="muted">
                    {c.status === "active"
                      ? "Active : les nouveaux prospects sont rattachés par ses sources."
                      : "Inactive : aucun nouveau prospect n’est rattaché."}
                  </p>
                </div>
                {c.status !== "active" ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => patch({ status: "active" })}
                  >
                    Activer
                  </button>
                ) : (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Désactiver la campagne ? Les nouveaux prospects ne seront plus rattachés à ses sources.",
                        )
                      )
                        void patch({ status: "inactive" });
                    }}
                  >
                    Désactiver
                  </button>
                )}
              </section>
            )}
          </section>
        </>
      )}
    </>
  );
}
