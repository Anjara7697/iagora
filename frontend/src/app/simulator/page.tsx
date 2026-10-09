"use client";

import { useState } from "react";
import ConversationView from "@/components/ConversationView";
import RunView from "@/components/TraceView";
import { Loading } from "@/components/ui";
import { api, ApiError, SIMULATOR_ENABLED } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { AgentRun, Campaign, Conversation, Page, Prospect } from "@/lib/types";
import { ProspectLink } from "@/components/ui";

type Session = { prospectId: number; conversationId: string; name: string };
type Result = { message: string; run: AgentRun };

export default function SimulatorPage() {
  const campaigns = useApi<Page<Campaign>>("/campaigns?limit=100");
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [targetCode, setTargetCode] = useState("");
  const [name, setName] = useState("Camille");
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Conversation["messages"]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!SIMULATOR_ENABLED) {
    return (
      <>
        <h1>Simulateur</h1>
        <p>Le simulateur est désactivé sur cet environnement.</p>
      </>
    );
  }

  const campaign = campaigns.data?.items.find((c) => c.id === campaignId) ?? campaigns.data?.items[0];

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function reload(conversationId: string) {
    const conv = await api<Conversation>(`/conversations/${conversationId}`);
    setMessages(conv.messages);
  }

  const start = () =>
    guard(async () => {
      if (!campaign) throw new ApiError(0, "Créez d'abord une campagne.");
      const email = `sim.${Math.random().toString(36).slice(2, 10)}@demo.example.com`;
      const created = await api<{ prospect: Prospect }>("/prospects", {
        method: "POST",
        body: {
          first_name: name || "Camille",
          email,
          channel: "email",
          campaign_id: campaign.id,
          source_id: campaign.sources[0]?.id,
          target_code: targetCode || campaign.targets[0]?.code,
        },
      });
      const conv = await api<{ conversation: Conversation }>("/conversations", {
        method: "POST",
        body: { prospect_id: created.prospect.id, channel: "email" },
      });
      setSession({ prospectId: created.prospect.id, conversationId: conv.conversation.id, name });
      setMessages([]);
      setRuns([]);
    });

  async function runAgent(conversationId: string): Promise<AgentRun> {
    const run = await api<AgentRun>("/agent/runs", {
      method: "POST",
      body: { conversation_id: conversationId },
    });
    setRuns((r) => [...r, run]);
    await reload(conversationId);
    return run;
  }

  const send = () =>
    guard(async () => {
      if (!session || !text.trim()) return;
      const content = text.trim();
      setText("");
      await api(`/conversations/${session.conversationId}/messages`, {
        method: "POST",
        body: { role: "prospect", content },
      });
      await reload(session.conversationId);
      await runAgent(session.conversationId);
    });

  const firstContact = () =>
    guard(async () => {
      if (session) await runAgent(session.conversationId);
    });

  const lastRun: Result["run"] | undefined = runs[runs.length - 1];
  const closed = lastRun !== undefined && ["human_handoff", "close", "opt_out"].includes(lastRun.action);

  return (
    <>
      <h1>Simulateur de prospect</h1>
      <p className="muted">
        Jouez un prospect <b>fictif</b> (adresse @demo.example.com) et regardez l&apos;agent répondre : mêmes
        règles, même base de connaissances et même modèle que pour un vrai prospect.
      </p>

      {!session && (
        <div className="card">
          <Loading loading={campaigns.loading} error={campaigns.error} />
          {campaigns.data && campaigns.data.items.length === 0 && (
            <p>
              Aucune campagne. Lancez <code>python -m app.cli seed-demo</code> ou créez-en une via l&apos;API.
            </p>
          )}
          {campaign && (
            <div className="form">
              <label>
                Campagne
                <select value={campaign.id} onChange={(e) => setCampaignId(Number(e.target.value))}>
                  {campaigns.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Programme visé
                <select value={targetCode || campaign.targets[0]?.code} onChange={(e) => setTargetCode(e.target.value)}>
                  {campaign.targets.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Prénom du prospect
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <button className="primary" disabled={busy} onClick={start}>
                Créer un prospect fictif
              </button>
            </div>
          )}
        </div>
      )}

      {session && (
        <>
          <div className="row">
            <strong>{session.name}</strong>
            <ProspectLink id={session.prospectId}>fiche complète →</ProspectLink>
            <span className="spacer" />
            <button
              onClick={() => {
                setSession(null);
                setMessages([]);
                setRuns([]);
              }}
            >
              Nouveau prospect
            </button>
          </div>

          <ConversationView messages={messages} />

          {lastRun && (
            <div className="card">
              <h3>Dernière décision</h3>
              <RunView run={lastRun} />
            </div>
          )}

          {error && <p className="error">{error}</p>}
          {closed && (
            <p className="muted">
              Conversation terminée ({lastRun?.action}). Créez un nouveau prospect pour recommencer.
            </p>
          )}
          <div className="composer">
            <input
              placeholder="Écrivez comme le prospect…"
              value={text}
              disabled={busy || closed}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="primary" disabled={busy || closed || !text.trim()} onClick={send}>
              {busy ? "…" : "Envoyer"}
            </button>
            {messages.length === 0 && (
              <button disabled={busy} onClick={firstContact}>
                Premier contact par l&apos;agent
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
