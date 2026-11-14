"use client";

import { toast } from "@heroui/react";
import { Check, Megaphone, MessagesSquare, Route, Send, UserPlus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import SimulationNotice from "@/components/SimulationNotice";
import { canUseSimulator } from "@/lib/access";
import GuidedSimulation from "@/components/GuidedSimulation";
import ConversationView from "@/components/ConversationView";
import { Btn, ErrorText, Field, LinkButton, SelectBox, Notice, Tag, TextInput, TextLink } from "@/components/ds/controls";
import { EmptyPanel, ErrorState, PageHeader, Screen, cx, initialsOf } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { AgentDecision } from "@/components/simulator/AgentDecision";
import { DemoDataCard } from "@/components/simulator/DemoDataCard";
import { END_ACTIONS, SCENARIOS, pendingDraft } from "@/components/simulator/shared";
import { ScoreBadge, Skeleton, StageBadge } from "@/components/ui";
import { api, ApiError, SIMULATOR_ENABLED, failure } from "@/lib/api";
import { replaceUrl } from "@/lib/url";
import { ACTIONS, CONSENT, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type {
  AgentRun,
  Campaign,
  Conversation,
  Message,
  Page,
  Prospect,
} from "@/lib/types";
import { Box } from "@/components/ds/card";

type Session = { prospectId: number; conversationId: string; name: string };

export default function SimulatorPage() {
  return (
    <Suspense>
      <Simulator />
    </Suspense>
  );
}

function Simulator() {
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
  // Parcours guidé ouvert dans l'adresse (`?mode=guide`, règle 6).
  const guided = useSearchParams().get("mode") === "guide";
  const setGuided = (on: boolean) => replaceUrl(on ? "/simulator?mode=guide" : "/simulator");
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
  // Un message préparé et non envoyé n'est pas perdu en quittant l'écran (règle 14).
  const { dialog: discardDialog } = useDiscardGuard(() => !guided && text.trim() !== "");

  if (!allowed) {
    return (
      <Screen>
        <PageHeader title="Simulateur" />
        <Notice tone="warning">
          {SIMULATOR_ENABLED
            ? "Le simulateur est réservé aux conseillers et aux administrateurs."
            : "Le simulateur est désactivé sur cet environnement."}
        </Notice>
      </Screen>
    );
  }

  if (guided) return <GuidedSimulation onBack={() => setGuided(false)} />;

  const campaign =
    campaigns.data?.items.find((c) => c.id === campaignId) ??
    campaigns.data?.items[0];

  /** `what` dit ce qui a échoué, avant le détail du serveur (règle 12). */
  async function guard(what: string, action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(failure(what, err));
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
    guard("Création du prospect fictif impossible", async () => {
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
      toast.success("Prospect fictif créé", { description: `${next.name} (@demo.example.com) attend votre premier message.` });
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
    guard("Envoi du message impossible", async () => {
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
    guard("Premier contact impossible", async () => {
      if (session) await runAgent(session);
    });

  const decide = (draft: Message, action: "approve" | "reject") =>
    guard(action === "approve" ? "Validation du brouillon impossible" : "Refus du brouillon impossible", async () => {
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
      toast.success(action === "approve" ? "Brouillon approuvé" : "Brouillon refusé", {
        description: action === "approve" ? "La réponse apparaît dans la conversation simulée." : "Le prospect simulé ne le recevra pas.",
      });
    });

  const purge = () =>
    guard("Suppression des données fictives impossible", async () => {
      const r = await api<{ prospects: number; conversations: number }>("/demo/data", { method: "DELETE" });
      setSession(null);
      setMessages([]);
      setRuns([]);
      setProspect(null);
      toast.success("Données fictives supprimées", {
        description: `${r.prospects} prospect(s) fictif(s) et ${r.conversations} conversation(s) supprimés.`,
      });
      demoData.reload();
    });

  const lastRun = runs[runs.length - 1];
  const current = shown !== null ? runs[shown] : lastRun;
  const closed = lastRun !== undefined && END_ACTIONS.includes(lastRun.action);
  const draft = pendingDraft(messages);
  const membership = prospect?.campaigns[0];
  const lastAgent = [...messages].reverse().find((m) => m.role === "agent");

  return (
    <Screen wide className="max-w-[1600px]">
      {discardDialog}
      <SimulationNotice>
        Prospects fictifs en @demo.example.com : aucun message n’est envoyé à
        l’extérieur. Les données de démonstration peuvent être supprimées
        séparément des vraies données.
      </SimulationNotice>
      <PageHeader
        {...reveal(0)}
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

      <div className={cx("grid grid-cols-1 gap-4 lg:grid-cols-2", reveal(1).className)} style={reveal(1).style}>
        <Box as="section" className="flex-row flex-wrap items-center gap-3 p-5" aria-label="Parcours guidé">
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
        </Box>
        {isAdmin && (
          <DemoDataCard
            counts={demoData.data}
            unavailable={!!demoData.error}
            disabled={busy || !demoData.data || demoData.data.prospects === 0}
            onPurge={() => void purge()}
          />
        )}
      </div>

      {mode.data?.mode === "assisted" && (
        <Notice tone="info">
          <span>
            Mode assisté : la réponse de l&apos;agent est un <b className="font-semibold">brouillon</b> à valider (ici ou
            dans <TextLink href="/todo" className="text-[13px]">À traiter</TextLink>).
          </span>
        </Notice>
      )}
      {/* État durable, avec l'action qui le résout (règle 13). */}
      {mode.data?.mode === "manual" && (
        <Notice tone="warning">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-[200px] flex-1">
              Arrêt d&apos;urgence actif : l&apos;agent ne répondra pas tant que le mode assisté n&apos;est pas repris.
            </span>
            <LinkButton size="sm" variant="outline" href="/agent">
              Ouvrir la page Agent
            </LinkButton>
          </div>
        </Notice>
      )}

      <div
        className={cx("grid grid-cols-1 items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]", reveal(2).className)}
        style={reveal(2).style}
      >
        <aside className="flex flex-col gap-4" aria-label="Prospect simulé">
          {!session ? (
            <Box as="section" className="gap-4 p-5">
              <h2 className="text-base font-semibold text-foreground">Nouveau prospect fictif</h2>
              {campaigns.loading && !campaigns.data && <Skeleton />}
              {campaigns.error && (
                <ErrorState message={`Chargement des campagnes impossible : ${campaigns.error.message}`} onRetry={campaigns.reload} />
              )}
              {campaigns.data && campaigns.data.items.length === 0 && (
                <EmptyPanel
                  icon={Megaphone}
                  title="Aucune campagne"
                  description="Le prospect fictif est rattaché à une campagne : créez-en une d’abord."
                  action={
                    isAdmin ? (
                      <LinkButton size="sm" variant="primary" href="/campaigns/new">
                        Créer une campagne
                      </LinkButton>
                    ) : undefined
                  }
                />
              )}
              {campaign && (
                <div className="flex flex-col gap-4">
                  <Field label="Campagne">
                    <SelectBox
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
                    </SelectBox>
                  </Field>
                  <Field label="Programme visé">
                    <SelectBox
                      value={targetCode || campaign.targets[0]?.code}
                      onChange={(e) => setTargetCode(e.target.value)}
                    >
                      {campaign.targets.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                        </option>
                      ))}
                    </SelectBox>
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
            </Box>
          ) : (
            <Box as="section" className="gap-3 p-5">
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
            </Box>
          )}

          {session && (
            <Box as="section" className="gap-3 p-5">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-foreground">Messages types</h3>
                <p className="text-xs text-muted">
                  Cliquez pour préparer le message, puis envoyez-le.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Messages types">
                {SCENARIOS.map((s) => (
                  <Btn
                    key={s.title}
                    variant="outline"
                    size="sm"
                    disabled={busy || closed}
                    onClick={() => setText(s.message)}
                  >
                    {s.title}
                  </Btn>
                ))}
              </div>
            </Box>
          )}
        </aside>

        <Box as="section" className="min-h-[520px] gap-0 p-0" aria-label="Conversation simulée">
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
                  {busy ? "Envoi en cours" : "Envoyer"}
                </Btn>
                {messages.length === 0 && (
                  <Btn disabled={busy} onClick={firstContact}>
                    Premier contact par l&apos;agent
                  </Btn>
                )}
              </div>
            </>
          )}
        </Box>

        <AgentDecision runs={runs} current={current} onShow={setShown} lastAgent={lastAgent} />
      </div>
    </Screen>
  );
}
