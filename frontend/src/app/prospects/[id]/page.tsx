"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import ConversationView from "@/components/ConversationView";
import RunView from "@/components/TraceView";
import { Loading, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CONSENT, HANDOFF_REASONS, STAGES, formatDate, fullName, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { AgentRun, Conversation, History, Prospect } from "@/lib/types";

const LEVEL = (t: number) => (t >= 75 ? "very_hot" : t >= 50 ? "hot" : t >= 25 ? "warm" : "cold");

export default function ProspectPage() {
  const { id } = useParams<{ id: string }>();
  const prospect = useApi<Prospect>(`/prospects/${id}`);
  const conversation = useApi<Conversation>(`/prospects/${id}/conversation`);
  const runs = useApi<AgentRun[]>(`/prospects/${id}/agent-runs`);
  const membership = prospect.data?.campaigns[0];
  const history = useApi<History>(membership ? `/campaign-prospects/${membership.id}/history` : null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAgent() {
    if (!conversation.data) return;
    setBusy(true);
    setActionError(null);
    try {
      await api("/agent/runs", { method: "POST", body: { conversation_id: conversation.data.id } });
      prospect.reload();
      conversation.reload();
      runs.reload();
      history.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const p = prospect.data;
  const conv = conversation.data;
  return (
    <>
      <Loading loading={prospect.loading} error={prospect.error} />
      {p && (
        <>
          <h1>{fullName(p)}</h1>
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
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="card">
              <h3>Pipeline</h3>
              {p.campaigns.length === 0 && <p className="muted">Aucune campagne.</p>}
              {p.campaigns.map((m) => (
                <div key={m.id} className="row">
                  <StageBadge stage={m.conversion_stage} />
                  <ScoreBadge total={m.total_score} level={LEVEL(m.total_score)} />
                  <span className="muted">
                    intérêt {m.interest_score} · adéquation {m.fit_score}
                  </span>
                </div>
              ))}
              {history.data && (
                <details>
                  <summary>Historique des étapes et des scores</summary>
                  <ul className="trace">
                    {history.data.stage_events.map((e) => (
                      <li key={`s${e.id}`}>
                        {formatDate(e.created_at)} — étape : {label(STAGES, e.from_stage)} → <b>{label(STAGES, e.to_stage)}</b>{" "}
                        {e.reason ? `(${e.reason})` : ""}
                      </li>
                    ))}
                    {history.data.score_events.map((e) => (
                      <li key={`p${e.id}`}>
                        {formatDate(e.created_at)} — {e.score_type} {e.points >= 0 ? "+" : ""}
                        {e.points} → {e.new_value} ({e.reason})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>

          <h2>Conversation</h2>
          {conversation.error?.status === 404 && <p className="muted">Aucune conversation.</p>}
          {conversation.error && conversation.error.status !== 404 && (
            <p className="error">{conversation.error.message}</p>
          )}
          {conv && (
            <>
              <div className="row">
                <span className={`badge conv-${conv.status}`}>{conv.status}</span>
                <span className="muted">canal {conv.channel}</span>
                <span className="spacer" />
                <button className="primary" disabled={busy || conv.status !== "open"} onClick={runAgent}>
                  {busy ? "L'agent réfléchit…" : "Lancer l'agent"}
                </button>
              </div>
              {actionError && <p className="error">{actionError}</p>}
              {conv.handoff && (
                <div className="card warnbox">
                  <strong>Fiche de transfert</strong> — {label(HANDOFF_REASONS, conv.handoff.reason)}
                  {conv.handoff.pending_question && <p>Question : « {conv.handoff.pending_question} »</p>}
                  <p>{conv.handoff.summary}</p>
                  <p>
                    <b>Action recommandée :</b> {conv.handoff.recommended_action}
                  </p>
                </div>
              )}
              <ConversationView messages={conv.messages} />
            </>
          )}

          <h2>Décisions de l&apos;agent</h2>
          <Loading loading={runs.loading} error={runs.error} />
          {runs.data?.length === 0 && <p className="muted">L&apos;agent n&apos;a pas encore traité ce prospect.</p>}
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
