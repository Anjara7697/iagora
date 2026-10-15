"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import ConversationView from "@/components/ConversationView";
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
import type { AgentRun, Conversation, History, Prospect } from "@/lib/types";

export default function ProspectPage() {
  const user = useCurrentUser();
  const { id } = useParams<{ id: string }>();
  const prospect = useApi<Prospect>(`/prospects/${id}`);
  const conversation = useApi<Conversation>(`/prospects/${id}/conversation`);
  const runs = useApi<AgentRun[]>(`/prospects/${id}/agent-runs`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
                <p className="muted">Aucune campagne.</p>
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
                  <StageBadge stage={m.conversion_stage} />
                  <ScoreBadge total={m.total_score} level={m.interest_status} />
                  <span className="muted">
                    intérêt {m.interest_score} · adéquation {m.fit_score}
                  </span>
                </div>
              ))}
              {p.campaigns.map((m, index) => (
                <MembershipHistory key={m.id} id={m.id} index={index + 1} />
              ))}
            </div>
          </div>

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
