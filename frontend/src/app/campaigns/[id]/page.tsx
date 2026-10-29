"use client";

import { CalendarDays, Pause, Pencil, Play, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import CampaignForm, { type CampaignValues } from "@/components/CampaignForm";
import CampaignOwnership from "@/components/CampaignOwnership";
import { useCurrentUser } from "@/components/AppShell";
import { Btn, ErrorText, LinkButton, NativeSelect, Tag, TextInput, TextLink, type Tone } from "@/components/ds/controls";
import { BarList, EmptyText, ErrorState, Eyebrow, KpiCard, Panel, PageHeader, Screen, initialsOf } from "@/components/ds/layout";
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
  PLATFORM_MARK,
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

const LEVEL_FILL: Record<string, string> = {
  very_hot: "bg-level-very-hot",
  hot: "bg-level-hot",
  warm: "bg-level-warm",
  cold: "bg-level-cold",
  none: "bg-default",
};

function Funnel({ stats }: { stats: CampaignStats }) {
  const rows = FUNNEL.map((step) => ({
    key: step.title,
    label: step.title,
    value: step.stages.reduce((sum, s) => sum + (stats.by_stage[s] ?? 0), 0),
  }));
  return (
    <Panel title="Entonnoir" label="Entonnoir">
      {stats.prospects === 0 ? (
        <EmptyText>Aucun prospect pour l&apos;instant.</EmptyText>
      ) : (
        <BarList rows={rows} labelWidth={130} />
      )}
    </Panel>
  );
}

function Levels({ stats }: { stats: CampaignStats }) {
  const order = ["very_hot", "hot", "warm", "cold", "none"];
  return (
    <Panel title="Niveaux d'intérêt" label="Niveaux d'intérêt">
      <BarList
        labelWidth={130}
        rows={order.map((k) => ({
          key: k,
          label: (
            <>
              <span className={`size-2 shrink-0 rounded-full ${LEVEL_FILL[k]}`} aria-hidden="true" />
              {k === "none" ? "Non évalué" : label(LEVELS, k)}
            </>
          ),
          value: stats.by_level[k] ?? 0,
          fill: LEVEL_FILL[k],
        }))}
      />
    </Panel>
  );
}

const TH = "px-4 py-2.5 font-medium";
const TD = "px-4 py-3";

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
    <Panel title="Sources de prospects" label="Sources" bodyClassName="gap-4 px-5 py-4">
      {campaign.sources.length === 0 ? (
        <EmptyText>
          Aucune source rattachée : aucun prospect ne peut entrer dans cette
          campagne.
        </EmptyText>
      ) : (
        <div
          className="overflow-x-auto rounded-xl border border-separator outline-none focus-visible:ring-2 focus-visible:ring-focus"
          tabIndex={0}
          role="region"
          aria-label="Sources de la campagne, défilement horizontal"
        >
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="bg-surface-secondary text-left text-xs text-muted">
              <tr>
                <th scope="col" className={TH}>Source</th>
                <th scope="col" className={TH}>Plateforme</th>
                <th scope="col" className={TH}>Type</th>
                <th scope="col" className={`${TH} text-right`}>Prospects</th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {campaign.sources.map((s) => (
                <tr key={s.id} className="border-t border-separator">
                  <td className={`${TD} font-medium text-foreground`}>
                    <span className="flex items-center gap-2.5">
                      <span
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground font-mono text-[9px] font-medium text-background"
                        aria-hidden="true"
                      >
                        {PLATFORM_MARK[s.platform ?? ""] ?? "•"}
                      </span>
                      {s.name}
                    </span>
                  </td>
                  <td className={`${TD} text-muted`}>{label(PLATFORMS, s.platform)}</td>
                  <td className={`${TD} text-muted`}>{label(SOURCE_TYPES, s.type)}</td>
                  <td className={`${TD} text-right font-mono tabular-nums`}>{counts.get(s.id) ?? 0}</td>
                  <td className={`${TD} text-right`}>
                    {canEdit && (
                      <Btn
                        variant="ghost"
                        size="sm"
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
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {canEdit && (
        <div className="grid grid-cols-1 gap-2 rounded-xl bg-surface-secondary p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
          <TextInput
            aria-label="Nom de la nouvelle source"
            placeholder="Nouvelle source (ex. Webinaire d'octobre)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <NativeSelect
            aria-label="Type de la nouvelle source"
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          >
            {Object.entries(SOURCE_TYPES).map(([k, text]) => (
              <option key={k} value={k}>
                {text}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Plateforme de la nouvelle source"
            value={draft.platform}
            onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
          >
            {Object.entries(PLATFORMS).map(([k, text]) => (
              <option key={k} value={k}>
                {text}
              </option>
            ))}
          </NativeSelect>
          <Btn
            variant="primary"
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
            <Plus className="size-4" aria-hidden="true" />
            Ajouter
          </Btn>
        </div>
      )}
    </Panel>
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
    <Panel
      title="Prospects de la campagne"
      label="Prospects de la campagne"
      bodyClassName="gap-4 px-5 py-4"
      action={
        <span className="flex items-center gap-2">
          <label htmlFor="campaign-stage" className="text-[13px] text-muted">
            Étape
          </label>
          <NativeSelect
            id="campaign-stage"
            className="w-44"
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
          </NativeSelect>
        </span>
      }
    >
      <Loading
        loading={list.loading && !list.data}
        error={list.error}
        onRetry={list.reload}
        shape="rows"
      />
      {list.data && items.length === 0 && (
        <EmptyText>
          {stage
            ? "Aucun prospect à cette étape."
            : "Aucun prospect pour l’instant. Ils arrivent par les sources de la campagne."}
        </EmptyText>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-separator">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">Prospects de la campagne</caption>
            <thead className="bg-surface-secondary text-left text-xs text-muted">
              <tr>
                <th scope="col" className={TH}>Prospect</th>
                <th scope="col" className={TH}>Étape</th>
                <th scope="col" className={TH}>Score</th>
                <th scope="col" className={TH}>Consentement</th>
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
                const name = fullName(p) || p.email || `#${p.id}`;
                return (
                  <tr key={p.id} className="border-t border-separator transition-colors hover:bg-surface-secondary/60">
                    <td className={TD}>
                      <span className="flex items-center gap-3">
                        <span
                          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-xs font-semibold text-foreground"
                          aria-hidden="true"
                        >
                          {initialsOf(name)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-2">
                            <Link
                              href={`/prospects/${p.id}`}
                              className="font-medium text-foreground hover:text-accent hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                            >
                              {name}
                            </Link>
                            <DemoBadge email={p.email} />
                          </span>
                          {p.email && <span className="text-xs text-muted">{p.email}</span>}
                        </span>
                      </span>
                    </td>
                    <td className={TD}>
                      {m ? <StageBadge stage={m.conversion_stage} /> : "-"}
                    </td>
                    <td className={TD}>
                      {m ? (
                        <ScoreBadge
                          total={m.total_score}
                          level={m.interest_status}
                        />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className={`${TD} text-muted`}>{label(CONSENT, p.consent_status)}</td>
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
    </Panel>
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

  const STATUS_TONE: Record<string, Tone> = { active: "success", draft: "warning", inactive: "neutral" };

  return (
    <Screen>
      <TextLink href="/campaigns" className="w-fit text-sm">
        ← Campagnes
      </TextLink>
      <Loading
        loading={campaign.loading}
        error={campaign.error}
        onRetry={campaign.reload}
      />
      {c && (
        <>
          <PageHeader
            eyebrow="Pilotage · Campagne"
            title={c.name}
            subtitle={
              <span className="flex flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <Tag tone={STATUS_TONE[c.status] ?? "neutral"}>{label(CAMPAIGN_STATUS, c.status)}</Tag>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {c.start_date || c.end_date
                      ? `${formatDay(c.start_date)} → ${formatDay(c.end_date)}`
                      : "Sans dates"}
                  </span>
                </span>
                {c.description && <span>{c.description}</span>}
              </span>
            }
            actions={
              <>
                {canEdit && !editing && (
                  <Btn
                    variant="outline"
                    disabled={!targets.data}
                    onClick={() => setEditing(true)}
                    aria-describedby={targets.error ? "campaign-targets-error" : undefined}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    Modifier la campagne
                  </Btn>
                )}
                <LinkButton variant="primary" href={`/prospects?campaign=${c.id}`}>
                  <Users className="size-4" aria-hidden="true" />
                  Voir les prospects
                </LinkButton>
              </>
            }
          />
          {canEdit && targets.error && (
            <span id="campaign-targets-error">
              <ErrorState
                message={`Liste des programmes indisponible : ${targets.error.message}`}
                onRetry={targets.reload}
              />
            </span>
          )}
          {error && !editing && <ErrorText>{error}</ErrorText>}

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
            <ErrorState
              message={`Statistiques indisponibles : ${stats.error.message}`}
              onRetry={stats.reload}
            />
          )}
          {stats.data && (
            <>
              <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Indicateurs de la campagne">
                <KpiCard label="Prospects" value={stats.data.prospects} />
                <KpiCard label="Score moyen" value={Math.round(stats.data.average_score * 10) / 10} />
                <KpiCard label="Rendez-vous" value={stats.data.meetings} />
                <KpiCard label="Convertis" value={stats.data.converted} />
              </section>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Funnel stats={stats.data} />
                <Levels stats={stats.data} />
              </div>
            </>
          )}
          <CampaignProspects campaign={c} />

          <section className="flex flex-col gap-4" aria-labelledby="campaign-settings-title">
            <div className="flex flex-col gap-1 border-t border-separator pt-6">
              <Eyebrow>Réglages</Eyebrow>
              <h2 id="campaign-settings-title" className="text-xl font-semibold text-foreground">
                Réglages de la campagne
              </h2>
              <p className="text-sm text-muted">
                {canEdit
                  ? "Responsable, programmes, sources et statut."
                  : "Consultation seule : réservé aux administrateurs."}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CampaignOwnership
                key={`${c.id}:${c.responsible_advisor_id}`}
                campaign={c}
                onDone={campaign.reload}
              />
              <div className="flex flex-col gap-4">
                <Panel title="Programmes visés" label="Programmes visés">
                  <div className="flex flex-wrap gap-1.5">
                    {c.targets.map((t) => (
                      <Tag key={t.code} tone="accent">
                        {label(TARGETS, t.code)}
                      </Tag>
                    ))}
                    {c.targets.length === 0 && (
                      <span className="text-sm text-muted">
                        Aucun programme : modifiez la campagne pour en choisir.
                      </span>
                    )}
                  </div>
                </Panel>
                {canEdit && (
                  <Panel title="Statut" label="Statut" bodyClassName="flex-row flex-wrap items-center gap-4 px-5 py-4">
                    <p className="min-w-[200px] flex-1 text-sm text-muted">
                      {c.status === "active"
                        ? "Active : les nouveaux prospects sont rattachés par ses sources."
                        : "Inactive : aucun nouveau prospect n’est rattaché."}
                    </p>
                    {c.status !== "active" ? (
                      <Btn
                        variant="primary"
                        disabled={busy}
                        onClick={() => patch({ status: "active" })}
                      >
                        <Play className="size-4" aria-hidden="true" />
                        Activer
                      </Btn>
                    ) : (
                      <Btn
                        variant="danger-soft"
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
                        <Pause className="size-4" aria-hidden="true" />
                        Désactiver
                      </Btn>
                    )}
                  </Panel>
                )}
              </div>
            </div>
            <Sources
              campaign={c}
              stats={stats.data}
              canEdit={canEdit}
              onChanged={reload}
            />
          </section>
        </>
      )}
    </Screen>
  );
}
