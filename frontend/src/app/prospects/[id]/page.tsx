"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useState } from "react";
import ProspectResultsReturn from "@/components/ProspectResultsReturn";
import ProspectTaskReturn from "@/components/ProspectTaskReturn";
import { useCurrentUser } from "@/components/AppShell";
import ConversationView from "@/components/ConversationView";
import { ErasePanel, ErasureResult } from "@/components/ErasePanel";
import MembershipActions from "@/components/MembershipActions";
import InteractionHistory from "@/components/InteractionHistory";
import RunView from "@/components/TraceView";
import { DemoBadge, Loading, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  ACTIONS,
  CHANNELS,
  CONSENT,
  CONVERSATION_STATUS,
  HANDOFF_REASONS,
  PROFILE_FIELDS,
  STAGES,
  formatDate,
  fullName,
  label,
} from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type {
  AgentRun,
  Campaign,
  Conversation,
  ErasureReport,
  History,
  Page,
  Prospect,
} from "@/lib/types";

export default function ProspectPage() {
  const user = useCurrentUser();
  const { id } = useParams<{ id: string }>();
  const prospect = useApi<Prospect>(`/prospects/${id}`);
  const conversation = useApi<Conversation>(`/prospects/${id}/conversation`);
  const runs = useApi<AgentRun[]>(`/prospects/${id}/agent-runs`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [erased, setErased] = useState<ErasureReport | null>(null);
  const [editingMembership, setEditingMembership] = useState<number | null>(
    null,
  );
  const advisors = useApi<Page<{ id: number; username: string }>>(
    "/advisors?limit=50&offset=0",
  );

  function refreshTracking() {
    setNotice("Suivi enregistré.");
    prospect.reload();
    setRevision((v) => v + 1);
  }

  async function runAgent() {
    if (!conversation.data) return;
    setBusy(true);
    setActionError(null);
    try {
      await api("/agent/runs", {
        method: "POST",
        body: { conversation_id: conversation.data.id },
      });
      prospect.reload();
      conversation.reload();
      setRevision((v) => v + 1);
      runs.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function consentAction(kind: "opt-out" | "consent") {
    if (kind === "opt-out") {
      if (
        !window.confirm(
          "Enregistrer la désinscription ? Les relances et les brouillons en attente seront annulés et plus aucun message ne pourra être envoyé à ce prospect.",
        )
      )
        return;
    }
    const source =
      kind === "opt-out"
        ? "demande enregistrée par un conseiller"
        : (
            window.prompt(
              "Source du consentement (ex. accord donné par téléphone le 12/10) :",
            ) ?? ""
          ).trim();
    if (!source) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/prospects/${id}/${kind}`, {
        method: "POST",
        body: { source, channel: conversation.data?.channel ?? null },
      });
      setNotice(
        kind === "opt-out"
          ? "Désinscription enregistrée."
          : "Consentement enregistré.",
      );
      setRevision((v) => v + 1);
      prospect.reload();
      conversation.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const p = prospect.data;
  const conv = conversation.data;
  const canWrite = user?.role === "ADMIN" || user?.role === "ADVISOR";
  const canGrant = p?.consent_status !== "opted_out" || user?.role === "ADMIN";
  const current =
    p?.campaigns.find((m) => m.id === p.current_membership_id) ??
    p?.campaigns[0];
  const lastRun = runs.data?.[0];
  const recommendation =
    conv?.handoff?.recommended_action ||
    (lastRun?.action ? label(ACTIONS, lastRun.action) : null);
  // Le bloc n'apparaît que s'il a quelque chose à dire : désinscription, campagne
  // à attribuer, ou décision de l'agent (pendant le chargement, il reste affiché).
  const showRecommendation =
    !!p &&
    (p.consent_status === "opted_out" ||
      p.campaigns.length === 0 ||
      !!recommendation ||
      !!conv?.handoff?.summary ||
      !!lastRun?.reason ||
      runs.loading ||
      conversation.loading ||
      !!runs.error);
  if (erased) return <ErasureResult report={erased} />;
  return (
    <>
      <Suspense>
        <ProspectTaskReturn />
      </Suspense>
      <Suspense fallback={
        <Link href="/prospects" className="profile-back">← Tous les prospects</Link>
      }>
        <ProspectResultsReturn />
      </Suspense>
      <Loading
        loading={prospect.loading}
        error={prospect.error}
        onRetry={prospect.reload}
      />
      {p && (
        <>
          <header className="profile-header">
            <span className="prospect-avatar profile-avatar" aria-hidden="true">
              {[p.first_name, p.last_name]
                .filter(Boolean)
                .map((name) => name![0])
                .join("")
                .slice(0, 2)
                .toUpperCase() || "?"}
            </span>
            <div className="profile-heading-main">
              <span className="eyebrow">Fiche prospect · #{p.id}</span>
              <h1>{fullName(p)}</h1>
              <div className="row">
                <DemoBadge email={p.email} />
                <span className={`ui-badge consent-${p.consent_status}`}>
                  {label(CONSENT, p.consent_status)}
                </span>
                {current && (
                  <>
                    <StageBadge stage={current.conversion_stage} />
                    <ScoreBadge
                      total={current.total_score}
                      level={current.interest_status}
                    />
                  </>
                )}
                {current?.campaign_name && (
                  <span className="ui-badge">{current.campaign_name}</span>
                )}
                {current?.source_name && (
                  <span className="ui-badge">{current.source_name}</span>
                )}
              </div>
            </div>
            <div className="profile-actions">
              {conv && (
                <Link
                  className="button-link"
                  href={`/conversations?id=${encodeURIComponent(conv.id)}`}
                >
                  Ouvrir dans Conversations
                </Link>
              )}
              {conv?.messages.some(
                (m) =>
                  (m.metadata.draft as { status?: string } | undefined)
                    ?.status === "pending",
              ) && (
                <Link
                  className="button-link"
                  href={`/todo?id=${encodeURIComponent(`draft:${conv.id}:${conv.messages.find((m) => (m.metadata.draft as { status?: string } | undefined)?.status === "pending")?.id}`)}`}
                >
                  Voir dans la file
                </Link>
              )}
            </div>
          </header>
          {notice && <p role="status">{notice}</p>}
          {actionError && (
            <p className="error" role="alert">
              {actionError}
            </p>
          )}
          {p.consent_status === "opted_out" && (
            <div className="ui-card warnbox">
              Ce prospect est désinscrit. Les communications sortantes sont
              bloquées.
            </div>
          )}
          <div className="profile-columns">
            <div className="profile-column">
              {showRecommendation && (
                <section
                  className="recommendation profile-recommendation"
                  aria-label="Prochaine action recommandée"
                >
                  <div className="recommendation-heading">
                    <span className="dot tone-ai" aria-hidden="true" />
                    Prochaine action recommandée
                  </div>
                  <div className="recommendation-body">
                    {p.consent_status === "opted_out" ? (
                      <>
                        <h2>Respecter la désinscription</h2>
                        <p>Aucun message ne peut être envoyé à ce prospect.</p>
                      </>
                    ) : (
                      <>
                        <h2>
                          {recommendation ??
                            (p.campaigns.length === 0
                              ? "Attribuer une campagne et une source"
                              : "Consulter le parcours du prospect")}
                        </h2>
                        {conv?.handoff?.summary ? (
                          <p>{conv.handoff.summary}</p>
                        ) : lastRun?.reason ? (
                          <p>{lastRun.reason}</p>
                        ) : (
                          <p className="muted">
                            Aucune recommandation de l’agent enregistrée pour
                            l’instant.
                          </p>
                        )}
                        {lastRun && !conv?.handoff && (
                          <p className="muted">
                            Dernière décision enregistrée le{" "}
                            {formatDate(lastRun.started_at)}.
                          </p>
                        )}
                      </>
                    )}
                    <Loading
                      loading={runs.loading || conversation.loading}
                      error={runs.error}
                      onRetry={runs.reload}
                    />
                  </div>
                </section>
              )}
              <section
                className="ui-card profile-card"
                aria-label="Profil collecté"
              >
                <h2>Profil collecté</h2>
                {Object.keys(p.profile).length === 0 ? (
                  <p className="muted">Rien de collecté pour l&apos;instant.</p>
                ) : (
                  <dl className="profile-fields">
                    {Object.entries(p.profile).map(([k, v]) => (
                      <div key={k}>
                        <dt>{PROFILE_FIELDS[k] ?? k}</dt>
                        <dd>
                          {typeof v === "object" && v !== null
                            ? JSON.stringify(v)
                            : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
              <section
                className="ui-card profile-card"
                aria-label="Conversation du prospect"
              >
                <div className="row">
                  <h2>Conversation</h2>
                  <span className="spacer" />
                  {conv && (
                    <span className="ui-badge">
                      {label(CHANNELS, conv.channel)}
                    </span>
                  )}
                </div>
                <Loading
                  loading={conversation.loading}
                  error={
                    conversation.error?.status === 404
                      ? null
                      : conversation.error
                  }
                  onRetry={conversation.reload}
                />
                {conversation.error?.status === 404 && (
                  <p className="muted">Aucune conversation.</p>
                )}
                {conv && (
                  <>
                    <div className="row">
                      <span className={`ui-badge conv-${conv.status}`}>
                        {label(CONVERSATION_STATUS, conv.status)}
                      </span>
                      <span className="spacer" />
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          p.campaigns.length === 0 ||
                          conv.status !== "open" ||
                          p.consent_status === "opted_out" ||
                          !canWrite
                        }
                        onClick={runAgent}
                      >
                        {busy ? "L'agent réfléchit…" : "Lancer l'agent"}
                      </button>
                    </div>
                    {user?.role === "VIEWER" && (
                      <p className="muted">
                        Votre accès observateur permet de consulter les échanges
                        et les décisions.
                      </p>
                    )}
                    {conv.handoff && (
                      <div className="profile-handoff">
                        <strong>Fiche de transfert</strong> —{" "}
                        {label(HANDOFF_REASONS, conv.handoff.reason)}
                        {conv.handoff.pending_question && (
                          <p>Question : « {conv.handoff.pending_question} »</p>
                        )}
                        <p>
                          <b>Action recommandée :</b>{" "}
                          {conv.handoff.recommended_action}
                        </p>
                      </div>
                    )}
                    <ConversationView
                      messages={conv.messages}
                      prospectName={fullName(p)}
                      channel={conv.channel}
                    />
                  </>
                )}
              </section>
              <InteractionHistory key={`${p.id}:${revision}`} id={p.id} />
            </div>
            <div className="profile-column">
              <section
                className="ui-card profile-card"
                aria-label="Identité et consentement"
              >
                <h2>Identité et origine</h2>
                <dl className="profile-fields">
                  <div>
                    <dt>Email</dt>
                    <dd>{p.email ?? "Non renseigné"}</dd>
                  </div>
                  <div>
                    <dt>Téléphone</dt>
                    <dd>{p.phone ?? "Non renseigné"}</dd>
                  </div>
                  <div>
                    <dt>Créé le</dt>
                    <dd>{formatDate(p.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Canal de l’échange</dt>
                    <dd>
                      {conv ? label(CHANNELS, conv.channel) : "Non renseigné"}
                    </dd>
                  </div>
                </dl>
                <div className="profile-consent">
                  <span className="eyebrow">Consentement</span>
                  <p>
                    {label(CONSENT, p.consent_status)}
                    {p.consent_source ? ` · ${p.consent_source}` : ""}
                  </p>
                  {canWrite && (
                    <div className="row">
                      {p.consent_status !== "opted_out" && (
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => consentAction("opt-out")}
                        >
                          Enregistrer une désinscription
                        </button>
                      )}
                      {p.consent_status !== "granted" && canGrant && (
                        <button
                          disabled={busy}
                          onClick={() => consentAction("consent")}
                        >
                          {p.consent_status === "opted_out"
                            ? "Lever la désinscription (administrateur)"
                            : "Enregistrer un consentement"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </section>
              <section
                className="ui-card profile-card"
                aria-label="Parcours commercial"
              >
                <h2>Parcours commercial</h2>
                {p.campaigns.length === 0 && (
                  <p className="warnbox">
                    À attribuer : choisissez une campagne et une source pour
                    démarrer le traitement automatique.
                  </p>
                )}
                {canWrite && p.campaigns.length === 0 && (
                  <CampaignAttribution
                    id={p.id}
                    onDone={() => {
                      refreshTracking();
                      conversation.reload();
                      runs.reload();
                    }}
                  />
                )}
                {p.current_membership_id && (
                  <p className="muted">
                    Contexte de l’agent : rattachement le plus récemment actif.
                    Les scores de chaque source restent distincts.
                  </p>
                )}
                {p.campaigns.map((m, index) => (
                  <div key={m.id} className="profile-membership">
                    <h3>
                      {m.campaign_id ? (
                        <Link href={`/campaigns/${m.campaign_id}`}>
                          {m.campaign_name ?? `Campagne ${m.campaign_id}`}
                        </Link>
                      ) : (
                        `Parcours ${index + 1}`
                      )}
                    </h3>
                    {m.source_name && (
                      <p className="muted">Source : {m.source_name}</p>
                    )}
                    <div className="row">
                      {m.id === p.current_membership_id && (
                        <span className="ui-badge">Contexte de l’agent</span>
                      )}
                      <StageBadge stage={m.conversion_stage} />
                      <ScoreBadge
                        total={m.total_score}
                        level={m.interest_status}
                      />
                    </div>
                    <p className="score-components">
                      Intérêt {m.interest_score} · Adéquation {m.fit_score}
                    </p>
                    <p>
                      Conseiller responsable :{" "}
                      <strong>
                        {advisors.data?.items.find(
                          (a) => a.id === m.assigned_advisor_id,
                        )?.username ??
                          (m.assigned_advisor_id
                            ? `Conseiller #${m.assigned_advisor_id}`
                            : "Non affecté")}
                      </strong>
                    </p>
                    <details
                      className="profile-edit"
                      open={editingMembership === m.id}
                      onToggle={(e) => {
                        if (e.currentTarget.open) setEditingMembership(m.id);
                        else
                          setEditingMembership((old) =>
                            old === m.id ? null : old,
                          );
                      }}
                    >
                      <summary data-membership={m.id}>
                        Modifier l’affectation ou l’étape
                      </summary>
                      <MembershipActions
                        key={`${m.id}:${m.assigned_advisor_id}:${m.assignment_is_override}:${m.conversion_stage}`}
                        membership={m}
                        onDone={refreshTracking}
                      />
                    </details>
                    <MembershipHistory
                      key={`${m.id}:${revision}`}
                      id={m.id}
                      index={index + 1}
                    />
                  </div>
                ))}
                <p className="muted">
                  Le score sert à prioriser le suivi du prospect.
                </p>
              </section>
              <section
                className="ui-card profile-card"
                aria-label="Décisions de l’agent"
              >
                <h2>Décisions de l&apos;agent</h2>
                <Loading
                  loading={runs.loading}
                  error={runs.error}
                  onRetry={runs.reload}
                />
                {runs.data?.length === 0 && (
                  <p className="muted">
                    L&apos;agent n&apos;a pas encore traité ce prospect.
                  </p>
                )}
                {runs.data?.map((r) => (
                  <div key={r.run_id} className="profile-run">
                    <div className="time">{formatDate(r.started_at)}</div>
                    <RunView run={r} />
                    {r.reply && <blockquote>{r.reply}</blockquote>}
                  </div>
                ))}
              </section>
            </div>
          </div>
          {user?.role === "ADMIN" && (
            <ErasePanel prospect={p} onErased={setErased} />
          )}
        </>
      )}
    </>
  );
}

function MembershipHistory({ id, index }: { id: number; index: number }) {
  const history = useApi<History>(`/campaign-prospects/${id}/history`);
  return (
    <>
      {history.data && (
        <details>
          <summary>Historique du parcours {index}</summary>
          <ul className="trace">
            {history.data.stage_events.map((e) => (
              <li key={`s${e.id}`}>
                {formatDate(e.created_at)} — étape :{" "}
                {label(STAGES, e.from_stage)} →{" "}
                <b>{label(STAGES, e.to_stage)}</b>{" "}
                {e.reason ? `(${e.reason})` : ""}
              </li>
            ))}
            {history.data.score_events.map((e) => (
              <li key={`p${e.id}`}>
                {formatDate(e.created_at)} — {e.score_type}{" "}
                {e.points >= 0 ? "+" : ""}
                {e.points} → {e.new_value} ({e.reason})
              </li>
            ))}
          </ul>
        </details>
      )}
      <Loading
        loading={history.loading}
        error={history.error}
        onRetry={history.reload}
      />
    </>
  );
}

function CampaignAttribution({
  id,
  onDone,
}: {
  id: number;
  onDone: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const campaigns = useApi<Page<Campaign>>(
    `/campaigns?status=active&limit=50&offset=${offset}`,
  );
  const [campaign, setCampaign] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = campaigns.data?.items.find((c) => c.id === Number(campaign));
  return (
    <form
      aria-label="Attribution commerciale"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/prospects/${id}/campaigns`, {
            method: "POST",
            body: {
              campaign_id: Number(campaign),
              source_id: Number(source),
            },
          });
          onDone();
        } catch (err) {
          setError(
            err instanceof ApiError ? err.message : "Attribution impossible",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Loading
        loading={campaigns.loading}
        error={campaigns.error}
        onRetry={campaigns.reload}
      />
      {campaigns.data && campaigns.data.total > 50 && (
        <div className="row">
          <button
            type="button"
            disabled={offset === 0 || busy}
            onClick={() => {
              setOffset(offset - 50);
              setCampaign("");
              setSource("");
            }}
          >
            Campagnes précédentes
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 50, campaigns.data.total)} /{" "}
            {campaigns.data.total}
          </span>
          <button
            type="button"
            disabled={offset + 50 >= campaigns.data.total || busy}
            onClick={() => {
              setOffset(offset + 50);
              setCampaign("");
              setSource("");
            }}
          >
            Campagnes suivantes
          </button>
        </div>
      )}
      <label>
        Campagne d’attribution
        <select
          value={campaign}
          disabled={busy || campaigns.loading}
          onChange={(e) => {
            setCampaign(e.target.value);
            setSource("");
          }}
        >
          <option value="">Choisir une campagne active</option>
          {campaigns.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Source d’attribution
        <select
          value={source}
          disabled={busy || !selected}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Choisir une source</option>
          {selected?.sources?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {selected?.sources?.length === 0 && (
        <p>
          Aucune source pour cette campagne. Un administrateur doit en ajouter
          une depuis la fiche campagne.
        </p>
      )}
      {campaigns.data?.total === 0 && (
        <p>
          Aucune campagne active. Un administrateur doit en créer ou en activer
          une.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy || !campaign || !source}>
        Attribuer et démarrer le suivi
      </button>
    </form>
  );
}
