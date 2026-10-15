"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import ConversationView from "@/components/ConversationView";
import MembershipActions from "@/components/MembershipActions";
import InteractionHistory from "@/components/InteractionHistory";
import RunView from "@/components/TraceView";
import { DemoBadge, Loading, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
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
  return (
    <>
      <Link href="/prospects" className="profile-back">
        ← Tous les prospects
      </Link>
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
            <div>
              <span className="eyebrow">Fiche prospect · #{p.id}</span>
              <h1>{fullName(p)}</h1>
              <DemoBadge email={p.email} />
              <div className="row">
                <span className={`badge consent-${p.consent_status}`}>
                  {label(CONSENT, p.consent_status)}
                </span>
                <span className="muted">
                  {p.email || p.phone || "Coordonnées non renseignées"}
                </span>
              </div>
            </div>
          </header>
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
          {notice && <p role="status">{notice}</p>}
          {actionError && (
            <p className="error" role="alert">
              {actionError}
            </p>
          )}
          {p.consent_status === "opted_out" && (
            <div className="card warnbox">
              Ce prospect est désinscrit. Les communications sortantes sont
              bloquées.
            </div>
          )}
          <div className="grid2">
            <div className="card">
              <h3>Identité</h3>
              <dl>
                <dt>Email</dt>
                <dd>{p.email ?? "-"}</dd>
                <dt>Téléphone</dt>
                <dd>{p.phone ?? "-"}</dd>
                <dt>Consentement</dt>
                <dd>
                  {label(CONSENT, p.consent_status)}
                  {p.consent_source ? ` (${p.consent_source})` : ""}
                </dd>
                <dt>Créé le</dt>
                <dd>{formatDate(p.created_at)}</dd>
              </dl>
              <h3>Profil collecté</h3>
              {Object.keys(p.profile).length === 0 ? (
                <p className="muted">Rien de collecté pour l&apos;instant.</p>
              ) : (
                <dl>
                  {Object.entries(p.profile).map(([k, v]) => (
                    <div key={k}>
                      <dt>{PROFILE_FIELDS[k] ?? k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="card">
              <h3>Pipeline</h3>
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
                    prospect.reload();
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
              {p.campaigns.map((m) => (
                <div key={m.id} className="row">
                  {m.campaign_id && (
                    <Link href={`/campaigns/${m.campaign_id}`}>
                      <strong>
                        {m.campaign_name ?? `Campagne ${m.campaign_id}`}
                      </strong>
                    </Link>
                  )}
                  {m.source_name && <span>Source : {m.source_name}</span>}
                  {m.id === p.current_membership_id && (
                    <span className="badge">Contexte de l’agent</span>
                  )}
                  <StageBadge stage={m.conversion_stage} />
                  <ScoreBadge total={m.total_score} level={m.interest_status} />
                  <span className="muted">
                    intérêt {m.interest_score} · adéquation {m.fit_score}
                  </span>
                </div>
              ))}
              {p.campaigns.map((m, index) => (
                <div key={m.id} className="card">
                  <h3>
                    Suivi du parcours {index + 1} ·{" "}
                    {m.campaign_name ?? `Rattachement ${m.id}`}
                    {m.source_name ? ` · ${m.source_name}` : ""}
                  </h3>
                  <MembershipActions
                    key={`${m.id}:${m.assigned_advisor_id}:${m.assignment_is_override}:${m.conversion_stage}`}
                    membership={m}
                    onDone={refreshTracking}
                  />
                  <MembershipHistory
                    key={`${m.id}:${revision}`}
                    id={m.id}
                    index={index + 1}
                  />
                </div>
              ))}
            </div>
          </div>

          <InteractionHistory key={`${p.id}:${revision}`} id={p.id} />

          <h2>Conversation</h2>
          <Loading loading={conversation.loading} error={null} />
          {conversation.error?.status === 404 && (
            <p className="muted">Aucune conversation.</p>
          )}
          {conversation.error && conversation.error.status !== 404 && (
            <p className="error">{conversation.error.message}</p>
          )}
          {conv && (
            <>
              <div className="row">
                <span className={`badge conv-${conv.status}`}>
                  {label(CONVERSATION_STATUS, conv.status)}
                </span>
                <span className="muted">
                  canal {label(CHANNELS, conv.channel)}
                </span>
                <Link href={`/conversations?id=${conv.id}`}>
                  Ouvrir dans Conversations
                </Link>
                <span className="spacer" />
                <button
                  className="primary"
                  disabled={
                    busy ||
                    p.campaigns.length === 0 ||
                    conv.status !== "open" ||
                    p.consent_status === "opted_out" ||
                    user?.role === "VIEWER"
                  }
                  onClick={runAgent}
                >
                  {busy ? "L'agent réfléchit…" : "Lancer l'agent"}
                </button>
              </div>
              {user?.role === "VIEWER" && (
                <p className="muted">
                  Votre accès observateur permet de consulter les échanges et
                  les décisions.
                </p>
              )}
              {conv.handoff && (
                <div className="card warnbox">
                  <strong>Fiche de transfert</strong> —{" "}
                  {label(HANDOFF_REASONS, conv.handoff.reason)}
                  {conv.handoff.pending_question && (
                    <p>Question : « {conv.handoff.pending_question} »</p>
                  )}
                  <p>{conv.handoff.summary}</p>
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
            <div key={r.run_id} className="card">
              <div className="muted">{formatDate(r.started_at)}</div>
              <RunView run={r} />
              {r.reply && <blockquote>{r.reply}</blockquote>}
            </div>
          ))}
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
