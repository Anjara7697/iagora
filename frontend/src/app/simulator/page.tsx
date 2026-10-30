"use client";

import { Check, Database, MessagesSquare, Route, Send, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import SimulationNotice from "@/components/SimulationNotice";
import { canUseSimulator } from "@/lib/access";
import GuidedSimulation from "@/components/GuidedSimulation";
import ConversationView from "@/components/ConversationView";
import RunView from "@/components/TraceView";
import { Btn, ErrorText, Field, FilterChip, NativeSelect, Notice, Tag, TextInput, TextLink } from "@/components/ds/controls";
import { PageHeader, Screen, initialsOf } from "@/components/ds/layout";
import { Loading, ScoreBadge, StageBadge } from "@/components/ui";
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
      <Screen>
        <PageHeader
          title="Simulateur"
          subtitle={
            SIMULATOR_ENABLED
              ? "Le simulateur est réservé aux conseillers et aux administrateurs."
              : "Le simulateur est désactivé sur cet environnement."
          }
        />
      </Screen>
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
    <Screen wide className="max-w-[1600px]">
      <SimulationNotice>
        Prospects fictifs en @demo.example.com : aucun message n’est envoyé à
        l’extérieur. Les données de démonstration peuvent être supprimées
        séparément des vraies données.
      </SimulationNotice>
      <PageHeader
        eyebrow="Tests · Simulateur libre"
        title="Simulateur de prospect"
        subtitle={
          <>
            Jouez un prospect <b className="font-semibold text-foreground">fictif</b> (adresse @demo.example.com) : mêmes
            règles, même base de connaissances et même modèle que pour un vrai
            prospect.
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card card--default flex-row flex-wrap items-center gap-3 p-5" aria-label="Parcours guidé">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">
            <Route className="size-4" />
          </span>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <h2 className="text-sm font-semibold text-foreground">Tester un parcours complet</h2>
            <p className="text-[13px]/[20px] text-muted">
              Qualification, objection et réservation dans un calendrier fictif,
              avec le vrai agent.
            </p>
          </div>
          <Btn variant="outline" size="sm" onClick={() => setGuided(true)}>
            Ouvrir le parcours guidé
          </Btn>
        </section>
        {isAdmin && (
          <section className="card card--default gap-3 p-5" aria-label="Données fictives">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-muted" aria-hidden="true">
                <Database className="size-4" />
              </span>
              <span className="min-w-[180px] flex-1 text-[13px]/[20px] text-muted">
                Données fictives en base :{" "}
                <b className="font-semibold text-foreground">
                  {demoData.data
                    ? `${demoData.data.prospects} prospect(s), ${demoData.data.conversations} conversation(s)`
                    : demoData.error
                      ? "indisponible"
                      : "…"}
                </b>
              </span>
              <Btn
                variant="danger-soft"
                size="sm"
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
                <Trash2 className="size-4" aria-hidden="true" />
                Supprimer les données fictives
              </Btn>
            </div>
            {purgeNotice && <Notice>{purgeNotice}</Notice>}
          </section>
        )}
      </div>

      {mode.data?.mode === "assisted" && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Sparkles className="size-4 text-agent" aria-hidden="true" />
          <span>
            Mode assisté : la réponse de l&apos;agent est un <b className="font-semibold text-foreground">brouillon</b> à
            valider (ici ou dans <TextLink href="/todo" className="text-[13px]">À traiter</TextLink>).
          </span>
        </p>
      )}
      {mode.data?.mode === "manual" && (
        <ErrorText>
          Arrêt d&apos;urgence actif : l&apos;agent ne répondra pas. Reprenez le
          mode assisté dans le menu.
        </ErrorText>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside className="flex flex-col gap-4" aria-label="Prospect simulé">
          {!session ? (
            <section className="card card--default gap-4 p-5">
              <h2 className="text-base font-semibold text-foreground">Nouveau prospect fictif</h2>
              <Loading
                loading={campaigns.loading}
                error={campaigns.error}
                onRetry={campaigns.reload}
              />
              {campaigns.data && campaigns.data.items.length === 0 && (
                <p className="text-[13px]/[20px] text-muted">
                  Aucune campagne. Lancez{" "}
                  <code className="rounded bg-surface-secondary px-1 font-mono text-xs">python -m app.cli seed-demo</code> ou créez-en une.
                </p>
              )}
              {campaign && (
                <div className="flex flex-col gap-4">
                  <Field label="Campagne">
                    <NativeSelect
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
                    </NativeSelect>
                  </Field>
                  <Field label="Programme visé">
                    <NativeSelect
                      value={targetCode || campaign.targets[0]?.code}
                      onChange={(e) => setTargetCode(e.target.value)}
                    >
                      {campaign.targets.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Prénom du prospect">
                    <TextInput value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Btn variant="primary" fullWidth disabled={busy} onClick={start}>
                    <UserPlus className="size-4" aria-hidden="true" />
                    Créer un prospect fictif
                  </Btn>
                </div>
              )}
            </section>
          ) : (
            <section className="card card--default gap-3 p-5">
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-sm font-semibold text-foreground"
                  aria-hidden="true"
                >
                  {initialsOf(session.name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <strong className="truncate text-sm font-semibold text-foreground">{session.name}</strong>
                  <span className="text-xs text-muted">Prospect fictif</span>
                </span>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSession(null);
                    setMessages([]);
                    setRuns([]);
                    setProspect(null);
                  }}
                >
                  Nouveau prospect
                </Btn>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
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
                  <Tag>{label(CONSENT, prospect.consent_status)}</Tag>
                )}
              </div>
              <TextLink href={`/prospects/${session.prospectId}`} className="w-fit text-[13px]">
                Voir la fiche complète →
              </TextLink>
            </section>
          )}

          {session && (
            <section className="card card--default gap-3 p-5">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-foreground">Messages types</h3>
                <p className="text-xs text-muted">
                  Cliquez pour préparer le message, puis envoyez-le.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Messages types">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    disabled={busy || closed}
                    onClick={() => setText(s.message)}
                    className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>

        <section className="card card--default min-h-[520px] gap-0 p-0" aria-label="Conversation simulée">
          <div className="flex min-h-14 items-center gap-2 border-b border-separator px-5 py-3">
            <MessagesSquare className="size-4 text-muted" aria-hidden="true" />
            <h2 className="flex-1 text-base font-semibold text-foreground">Conversation</h2>
            <Tag tone="agent">Simulation</Tag>
          </div>
          {!session && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-surface-secondary text-muted" aria-hidden="true">
                <MessagesSquare className="size-5" />
              </span>
              <p className="text-sm text-muted">
                Créez un prospect fictif pour commencer l&apos;échange.
              </p>
            </div>
          )}
          {session && (
            <>
              <div className="flex flex-1 flex-col gap-4 bg-background/60 px-5 py-5">
                <ConversationView messages={messages} prospectName={session.name} channel="email" />
                {draft && (
                  <div className="flex flex-col gap-3 rounded-xl border border-dashed border-agent/50 bg-agent-soft/60 px-4 py-3 text-sm text-foreground" role="status">
                    Brouillon de l&apos;agent en attente de validation.
                    <div className="flex flex-wrap items-center gap-2">
                      <Btn
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => decide(draft, "approve")}
                      >
                        <Check className="size-4" aria-hidden="true" />
                        Approuver
                      </Btn>
                      <Btn
                        variant="danger-soft"
                        size="sm"
                        disabled={busy}
                        onClick={() => decide(draft, "reject")}
                      >
                        <X className="size-4" aria-hidden="true" />
                        Refuser
                      </Btn>
                      <TextLink
                        className="text-[13px]"
                        href={`/todo?id=${encodeURIComponent(`draft:${session.conversationId}:${draft.id}`)}`}
                      >
                        Traiter dans « À traiter »
                      </TextLink>
                    </div>
                  </div>
                )}
                {error && <ErrorText>{error}</ErrorText>}
                {closed && (
                  <p className="text-[13px] text-muted">
                    Conversation terminée ({label(ACTIONS, lastRun?.action)}).
                    Créez un nouveau prospect pour recommencer.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-separator px-5 py-4">
                <TextInput
                  aria-label="Message du prospect"
                  placeholder="Écrivez comme le prospect…"
                  className="min-w-[200px] flex-1"
                  value={text}
                  disabled={busy || closed}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                />
                <Btn
                  variant="primary"
                  disabled={busy || closed || !text.trim()}
                  onClick={send}
                >
                  <Send className="size-4" aria-hidden="true" />
                  {busy ? "…" : "Envoyer"}
                </Btn>
                {messages.length === 0 && (
                  <Btn disabled={busy} onClick={firstContact}>
                    Premier contact par l&apos;agent
                  </Btn>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="card card--default gap-4 p-5" aria-label="Décision de l'agent">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-agent" aria-hidden="true" />
            <h3 className="text-base font-semibold text-foreground">Décision de l&apos;agent</h3>
          </div>
          {!current && (
            <p className="text-[13px] text-muted">
              La décision apparaîtra après le premier message.
            </p>
          )}
          {current && (
            <>
              {runs.length > 1 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tours">
                  {runs.map((_, i) => (
                    <FilterChip
                      key={i}
                      pressed={current === runs[i]}
                      onClick={() => setShown(i)}
                    >
                      Tour {i + 1}
                    </FilterChip>
                  ))}
                </div>
              )}
              <RunView run={current} />
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-separator pt-4 text-[13px]">
                <dt className="text-muted">Intérêt / adéquation</dt>
                <dd className="font-mono text-foreground tabular-nums">
                  {current.scores.interest ?? "-"} /{" "}
                  {current.scores.fit ?? "-"}
                </dd>
                <dt className="text-muted">Étape</dt>
                <dd className="text-foreground">
                  {label(STAGES, current.stage_before)} →{" "}
                  {label(STAGES, current.stage_after)}
                </dd>
                {current === lastRun && (
                  <>
                    <dt className="text-muted">Sources</dt>
                    <dd className="text-foreground">
                      {sources.length > 0 ? sources.join(" ; ") : "aucune"}
                    </dd>
                    <dt className="text-muted">Confiance</dt>
                    <dd className="font-mono text-foreground tabular-nums">
                      {confidence !== null
                        ? `${Math.round(confidence * 100)} %`
                        : "-"}
                    </dd>
                  </>
                )}
              </dl>
            </>
          )}
        </aside>
      </div>
    </Screen>
  );
}
