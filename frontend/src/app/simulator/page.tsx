"use client";

import Link from "next/link";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import SimulationNotice from "@/components/SimulationNotice";
import { canUseSimulator } from "@/lib/access";
import GuidedSimulation from "@/components/GuidedSimulation";
import ConversationView from "@/components/ConversationView";
import RunView from "@/components/TraceView";
import { Loading, ProspectLink, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError, SIMULATOR_ENABLED } from "@/lib/api";
import { ACTIONS, CONSENT, STAGES, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type {
  AgentRun,
  Campaign,
  Conversation,
  Message,
  Page,
  Prospect,
} from "@/lib/types";

type Session = { prospectId: number; conversationId: string; name: string };

/** Messages types pour tester rapidement les cas importants du cahier des charges. */
const SCENARIOS: { title: string; message: string }[] = [
  { title: "Durée", message: "Combien de temps dure le programme ?" },
  { title: "Admission", message: "Quelles sont les conditions d'admission ?" },
  { title: "Prix", message: "Combien coûte la formation ?" },
  {
    title: "Financement (hors base)",
    message: "Puis-je financer la formation avec mon CPF ?",
  },
  { title: "Programmes", message: "Quelles formations proposez-vous ?" },
  {
    title: "Rendez-vous",
    message: "Je voudrais prendre rendez-vous avec un conseiller.",
  },
  {
    title: "Veut un conseiller",
    message: "Je préfère parler directement à un conseiller.",
  },
  {
    title: "Situation sensible",
    message: "Je vais porter plainte contre votre école.",
  },
  { title: "Pas intéressé", message: "Non merci, ça ne m'intéresse pas." },
  { title: "Désinscription", message: "STOP, ne m'écrivez plus." },
];

const END_ACTIONS = ["human_handoff", "close", "opt_out"];

function pendingDraft(messages: Message[]): Message | undefined {
  const last = [...messages].reverse().find((m) => {
    const status = (m.metadata.draft as { status?: string } | undefined)
      ?.status;
    return (
      m.role === "agent" &&
      status !== "rejected" &&
      status !== "superseded" &&
      status !== "cancelled"
    );
  });
  const status = (last?.metadata.draft as { status?: string } | undefined)
    ?.status;
  return status === "pending" ? last : undefined;
}

export default function SimulatorPage() {
  const user = useCurrentUser();
  const allowed = canUseSimulator(user?.role);
  const campaigns = useApi<Page<Campaign>>(
    allowed ? "/campaigns?limit=100" : null,
  );
  const mode = useApi<{ mode: string }>(allowed ? "/agent/mode" : null);
  const isAdmin = user?.role === "ADMIN";
  const demoData = useApi<{ prospects: number; conversations: number }>(
    isAdmin && allowed ? "/demo" : null,
  );
  const [purgeNotice, setPurgeNotice] = useState<string | null>(null);
  const [guided, setGuided] = useState(false);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [targetCode, setTargetCode] = useState("");
  const [name, setName] = useState("Camille");
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!allowed) {
    return (
      <>
        <h1>Simulateur</h1>
        <p>
          {SIMULATOR_ENABLED
            ? "Le simulateur est réservé aux conseillers et aux administrateurs."
            : "Le simulateur est désactivé sur cet environnement."}
        </p>
      </>
    );
  }

  if (guided) return <GuidedSimulation onBack={() => setGuided(false)} />;

  const campaign =
    campaigns.data?.items.find((c) => c.id === campaignId) ??
    campaigns.data?.items[0];

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

  async function refresh(s: Session) {
    const [conv, p] = await Promise.all([
      api<Conversation>(`/conversations/${s.conversationId}`),
      api<Prospect>(`/prospects/${s.prospectId}`),
    ]);
    setMessages(conv.messages);
    setProspect(p);
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
      const next = {
        prospectId: created.prospect.id,
        conversationId: conv.conversation.id,
        name: name || "Camille",
      };
      setSession(next);
      setRuns([]);
      setShown(null);
      await refresh(next);
    });

  async function runAgent(s: Session) {
    let run: AgentRun;
    try {
      run = await api<AgentRun>("/agent/runs", {
        method: "POST",
        body: { conversation_id: s.conversationId },
      });
    } catch (err) {
      // Déclenchement automatique : l'agent a déjà répondu au message ; on reprend sa décision.
      if (
        !(err instanceof ApiError) ||
        err.status !== 409 ||
        !err.message.includes("Aucun message du prospect")
      )
        throw err;
      const latest = await api<AgentRun[]>(
        `/prospects/${s.prospectId}/agent-runs`,
      );
      if (latest.length === 0) throw err;
      run = latest[0];
    }
    setRuns((r) => (r.some((x) => x.run_id === run.run_id) ? r : [...r, run]));
    setShown(null);
    await refresh(s);
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
      await refresh(session);
      await runAgent(session);
    });

  const firstContact = () =>
    guard(async () => {
      if (session) await runAgent(session);
    });

  const decide = (draft: Message, action: "approve" | "reject") =>
    guard(async () => {
      if (!session) return;
      await api(
        `/conversations/${session.conversationId}/drafts/${draft.id}/${action}`,
        {
          method: "POST",
          body:
            action === "reject"
              ? { reason: "Refusé depuis le simulateur" }
              : {},
        },
      );
      await refresh(session);
    });

  const lastRun = runs[runs.length - 1];
  const current = shown !== null ? runs[shown] : lastRun;
  const closed = lastRun !== undefined && END_ACTIONS.includes(lastRun.action);
  const draft = pendingDraft(messages);
  const membership = prospect?.campaigns[0];
  const lastAgent = [...messages].reverse().find((m) => m.role === "agent");
  const sources = Array.isArray(lastAgent?.metadata.sources)
    ? (lastAgent?.metadata.sources as string[])
    : [];
  const confidence =
    typeof lastAgent?.metadata.confidence === "number"
      ? (lastAgent.metadata.confidence as number)
      : null;

  return (
    <>
      <SimulationNotice>
        Prospects fictifs en @demo.example.com : aucun message n’est envoyé à
        l’extérieur. Les données de démonstration peuvent être supprimées
        séparément des vraies données.
      </SimulationNotice>
      <div className="page-heading">
        <div>
          <h1>Simulateur de prospect</h1>
          <p className="muted">
            Jouez un prospect <b>fictif</b> (adresse @demo.example.com) : mêmes
            règles, même base de connaissances et même modèle que pour un vrai
            prospect.
          </p>
        </div>
      </div>

      <section className="card">
        <h2>Tester un parcours complet</h2>
        <p>
          Qualification, objection et réservation dans un calendrier fictif,
          avec le vrai agent.
        </p>
        <button onClick={() => setGuided(true)}>
          Ouvrir le parcours guidé
        </button>
      </section>

      {mode.data?.mode === "assisted" && (
        <p className="muted">
          Mode assisté : la réponse de l&apos;agent est un <b>brouillon</b> à
          valider (ici ou dans <Link href="/todo">À traiter</Link>).
        </p>
      )}
      {mode.data?.mode === "manual" && (
        <p className="error">
          Arrêt d&apos;urgence actif : l&apos;agent ne répondra pas. Reprenez le
          mode assisté dans le menu.
        </p>
      )}

      {isAdmin && (
        <section className="card" aria-label="Données fictives">
          <div className="row">
            <span>
              Données fictives en base :{" "}
              <b>
                {demoData.data
                  ? `${demoData.data.prospects} prospect(s), ${demoData.data.conversations} conversation(s)`
                  : demoData.error
                    ? "indisponible"
                    : "…"}
              </b>
            </span>
            <span className="spacer" />
            <button
              className="danger"
              disabled={busy || !demoData.data || demoData.data.prospects === 0}
              onClick={() => {
                if (
                  !window.confirm(
                    "Supprimer tous les prospects fictifs (@demo.example.com) et leurs conversations ? Les vraies données ne sont pas touchées.",
                  )
                )
                  return;
                void guard(async () => {
                  const r = await api<{
                    prospects: number;
                    conversations: number;
                  }>("/demo/data", { method: "DELETE" });
                  setSession(null);
                  setMessages([]);
                  setRuns([]);
                  setPurgeNotice(
                    `${r.prospects} prospect(s) fictif(s) et ${r.conversations} conversation(s) supprimés.`,
                  );
                  demoData.reload();
                });
              }}
            >
              Supprimer les données fictives
            </button>
          </div>
          {purgeNotice && <p role="status">{purgeNotice}</p>}
        </section>
      )}

      <div className="sim">
        <aside className="sim-side" aria-label="Prospect simulé">
          {!session ? (
            <div className="card">
              <h2>Nouveau prospect fictif</h2>
              <Loading
                loading={campaigns.loading}
                error={campaigns.error}
                onRetry={campaigns.reload}
              />
              {campaigns.data && campaigns.data.items.length === 0 && (
                <p>
                  Aucune campagne. Lancez{" "}
                  <code>python -m app.cli seed-demo</code> ou créez-en une.
                </p>
              )}
              {campaign && (
                <div className="form">
                  <label>
                    Campagne
                    <select
                      value={campaign.id}
                      onChange={(e) => {
                        setCampaignId(Number(e.target.value));
                        setTargetCode(""); // le programme dépend de la campagne choisie
                      }}
                    >
                      {campaigns.data?.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Programme visé
                    <select
                      value={targetCode || campaign.targets[0]?.code}
                      onChange={(e) => setTargetCode(e.target.value)}
                    >
                      {campaign.targets.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Prénom du prospect
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <button className="primary" disabled={busy} onClick={start}>
                    Créer un prospect fictif
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <div className="row">
                <strong>{session.name}</strong>
                <span className="spacer" />
                <button
                  onClick={() => {
                    setSession(null);
                    setMessages([]);
                    setRuns([]);
                    setProspect(null);
                  }}
                >
                  Nouveau prospect
                </button>
              </div>
              <div className="row">
                {membership && (
                  <StageBadge stage={membership.conversion_stage} />
                )}
                {membership && (
                  <ScoreBadge
                    total={membership.total_score}
                    level={current?.scores.level}
                  />
                )}
                {prospect && (
                  <span className="badge">
                    {label(CONSENT, prospect.consent_status)}
                  </span>
                )}
              </div>
              <p>
                <ProspectLink id={session.prospectId}>
                  Voir la fiche complète →
                </ProspectLink>
              </p>
            </div>
          )}

          {session && (
            <div className="card">
              <h3>Messages types</h3>
              <p className="muted">
                Cliquez pour préparer le message, puis envoyez-le.
              </p>
              <div className="chips" role="group" aria-label="Messages types">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.title}
                    disabled={busy || closed}
                    onClick={() => setText(s.message)}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="sim-main" aria-label="Conversation simulée">
          {!session && (
            <div className="card inbox-placeholder">
              <p className="muted">
                Créez un prospect fictif pour commencer l&apos;échange.
              </p>
            </div>
          )}
          {session && (
            <>
              <ConversationView messages={messages} />
              {draft && (
                <div className="card warnbox" role="status">
                  Brouillon de l&apos;agent en attente de validation.
                  <div className="row">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => decide(draft, "approve")}
                    >
                      Approuver
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => decide(draft, "reject")}
                    >
                      Refuser
                    </button>
                    <Link
                      href={`/todo?id=${encodeURIComponent(`draft:${session.conversationId}:${draft.id}`)}`}
                    >
                      Traiter dans « À traiter »
                    </Link>
                  </div>
                </div>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {closed && (
                <p className="muted">
                  Conversation terminée ({label(ACTIONS, lastRun?.action)}).
                  Créez un nouveau prospect pour recommencer.
                </p>
              )}
              <div className="composer">
                <input
                  aria-label="Message du prospect"
                  placeholder="Écrivez comme le prospect…"
                  value={text}
                  disabled={busy || closed}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                />
                <button
                  className="primary"
                  disabled={busy || closed || !text.trim()}
                  onClick={send}
                >
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
        </section>

        <aside className="sim-side" aria-label="Décision de l'agent">
          <div className="card">
            <h3>Décision de l&apos;agent</h3>
            {!current && (
              <p className="muted">
                La décision apparaîtra après le premier message.
              </p>
            )}
            {current && (
              <>
                {runs.length > 1 && (
                  <div className="chips" role="group" aria-label="Tours">
                    {runs.map((_, i) => (
                      <button
                        key={i}
                        aria-pressed={current === runs[i]}
                        onClick={() => setShown(i)}
                      >
                        Tour {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                <RunView run={current} />
                <dl className="sim-facts">
                  <dt>Intérêt / adéquation</dt>
                  <dd>
                    {current.scores.interest ?? "-"} /{" "}
                    {current.scores.fit ?? "-"}
                  </dd>
                  <dt>Étape</dt>
                  <dd>
                    {label(STAGES, current.stage_before)} →{" "}
                    {label(STAGES, current.stage_after)}
                  </dd>
                  {current === lastRun && (
                    <>
                      <dt>Sources</dt>
                      <dd>
                        {sources.length > 0 ? sources.join(" ; ") : "aucune"}
                      </dd>
                      <dt>Confiance</dt>
                      <dd>
                        {confidence !== null
                          ? `${Math.round(confidence * 100)} %`
                          : "-"}
                      </dd>
                    </>
                  )}
                </dl>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
