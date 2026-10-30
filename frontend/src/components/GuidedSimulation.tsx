"use client";

import { ArrowLeft, CalendarCheck, Check, ChevronRight, Inbox, MessagesSquare, Play, RefreshCw, Route, Send, X } from "lucide-react";
import { useState } from "react";
import SimulationNotice from "./SimulationNotice";
import ConversationView from "@/components/ConversationView";
import RunView from "@/components/TraceView";
import { Btn, ErrorText, Field, Tag, TextBox, TextLink } from "@/components/ds/controls";
import { PageHeader, Screen } from "@/components/ds/layout";
import { api, ApiError } from "@/lib/api";
import { ACTIONS, PROFILE_FIELDS, formatDate, label } from "@/lib/labels";
import type { AgentRun, Conversation, Prospect } from "@/lib/types";

type Session = {
  prospect_id: number;
  conversation_id: string;
  guide: string[];
};
type Report = {
  guide: string[];
  exchange: { messages: { id: string; role: string; content: string }[] };
  appointments: { id: number; start_at: string; meeting_url: string | null }[];
  limits: string[];
  model_validation: string;
};

export default function GuidedSimulation({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [text, setText] = useState("");
  const [outbound, setOutbound] = useState<{
    content: string;
    id: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Échec de la simulation",
      );
    } finally {
      setBusy(false);
    }
  }

  async function refresh(s: Session) {
    const [c, p, r, summary] = await Promise.all([
      api<Conversation>(`/conversations/${s.conversation_id}`),
      api<Prospect>(`/prospects/${s.prospect_id}`),
      api<AgentRun[]>(`/prospects/${s.prospect_id}/agent-runs`),
      api<Report>(`/simulation/${s.conversation_id}/report`),
    ]);
    setConversation(c);
    setProspect(p);
    setRuns(r);
    setReport(summary);
  }

  const pending = conversation?.messages.find(
    (m) =>
      (m.metadata.draft as { status?: string } | undefined)?.status ===
      "pending",
  );
  const stopped =
    prospect?.consent_status === "opted_out" ||
    conversation?.status === "closed" ||
    conversation?.status === "handed_off";

  async function send() {
    if (!session || !text.trim()) return;
    const content = text.trim();
    const message =
      outbound?.content === content
        ? outbound
        : { content, id: crypto.randomUUID() };
    setOutbound(message);
    await guard(async () => {
      try {
        await api(`/simulation/${session.conversation_id}/messages`, {
          method: "POST",
          body: { content, external_message_id: message.id },
        });
        setText("");
        setOutbound(null);
      } finally {
        await refresh(session);
      }
    });
  }

  const profile = Object.entries(prospect?.profile ?? {});

  return (
    <Screen wide className="max-w-[1600px]">
      <SimulationNotice>
        Agent et modèle configurés réels ; campagne, documents, boîte email et
        calendrier fictifs. Aucun email externe. Le rendez-vous réservé reste
        fictif et ne vaut pas conversion.
      </SimulationNotice>
      <PageHeader
        eyebrow="Banc d’essai · parcours guidé"
        title="De la qualification au rendez-vous"
        subtitle="Vous jouez Camille, titulaire d’un Bac+3 en informatique, qui souhaite devenir data analyst en alternance."
        actions={
          <Btn variant="outline" disabled={busy} onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Retour au simulateur libre
          </Btn>
        }
      />
      {error && <ErrorText>{error}</ErrorText>}
      {!session && (
        <section className="card card--default max-w-[760px] gap-4 p-6">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent" aria-hidden="true">
            <Route className="size-5" />
          </span>
          <h2 className="text-lg font-semibold text-foreground">Premier parcours</h2>
          <p className="text-sm/[22px] text-muted">
            Présentez votre besoin, précisez votre profil, exprimez une
            objection puis demandez un rendez-vous. En mode assisté, validez
            chaque brouillon avant de jouer la réponse du prospect.
          </p>
          <p className="text-sm/[22px] text-muted">
            Les documents de test couvrent la durée, l’alternance et
            l’accompagnement. Le prix et le financement sont volontairement
            inconnus.
          </p>
          <Btn
            variant="primary"
            className="w-fit"
            disabled={busy}
            onClick={() =>
              void guard(async () => {
                const s = await api<Session>("/simulation/sessions", {
                  method: "POST",
                  body: { first_name: "Camille" },
                });
                setSession(s);
                await refresh(s);
              })
            }
          >
            <Play className="size-4" aria-hidden="true" />
            Démarrer le parcours guidé
          </Btn>
        </section>
      )}
      {session && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <section className="card card--default gap-4 p-5" aria-label="Guide du parcours">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-foreground">Messages suggérés</h2>
              <p className="text-[13px]/[20px] text-muted">
                Adaptez-les aux réponses de l’agent ; un clic prépare le message
                sans l’envoyer.
              </p>
            </div>
            <ol className="flex flex-col gap-2">
              {session.guide.map((message, i) => (
                <li key={message}>
                  <button
                    type="button"
                    disabled={busy || stopped}
                    onClick={() => setText(message)}
                    className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-[13px]/[19px] text-foreground outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] text-accent-soft-foreground" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>
                      <span className="sr-only">Étape {i + 1} : </span>
                      {message}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <TextLink href={`/prospects/${session.prospect_id}`} className="w-fit text-[13px]">
              Voir le prospect fictif et son suivi
            </TextLink>
          </section>

          <section className="card card--default gap-0 p-0" aria-label="Échange opérateur">
            <div className="flex min-h-14 items-center gap-2 border-b border-separator px-5 py-3">
              <MessagesSquare className="size-4 text-muted" aria-hidden="true" />
              <h2 className="flex-1 text-base font-semibold text-foreground">Échange et brouillons</h2>
              <Tag tone="agent">Vrai agent</Tag>
            </div>
            <div className="flex flex-col gap-4 bg-background/60 px-5 py-5">
              <ConversationView
                messages={conversation?.messages ?? []}
                prospectName="Camille"
                channel="email"
              />
              {pending && (
                <div className="flex flex-col gap-3 rounded-xl border border-dashed border-agent/50 bg-agent-soft/60 px-4 py-3 text-sm text-foreground" role="status">
                  Brouillon invisible pour le prospect tant qu’il n’est pas
                  validé.
                  <div className="flex flex-wrap items-center gap-2">
                    <Btn
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void guard(async () => {
                          await api(
                            `/simulation/${session.conversation_id}/drafts/${pending.id}/approve`,
                            { method: "POST" },
                          );
                          await refresh(session);
                        })
                      }
                    >
                      <Check className="size-4" aria-hidden="true" />
                      Valider et livrer dans la boîte fictive
                    </Btn>
                    <Btn
                      variant="danger-soft"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void guard(async () => {
                          await api(
                            `/conversations/${session.conversation_id}/drafts/${pending.id}/reject`,
                            {
                              method: "POST",
                              body: {
                                reason: "Refusé pendant la recette guidée",
                              },
                            },
                          );
                          await refresh(session);
                        })
                      }
                    >
                      <X className="size-4" aria-hidden="true" />
                      Refuser le brouillon
                    </Btn>
                  </div>
                </div>
              )}
              {stopped && (
                <p role="status" className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
                  Parcours arrêté :{" "}
                  {prospect?.consent_status === "opted_out"
                    ? "prospect désinscrit"
                    : conversation?.status === "handed_off"
                      ? "conversation transférée au conseiller"
                      : "conversation clôturée"}
                  .
                </p>
              )}
            </div>
            <div className="flex flex-col gap-3 border-t border-separator px-5 py-4">
              <Field label="Message du prospect">
                <TextBox
                  value={text}
                  disabled={busy || stopped}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Écrivez comme Camille…"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Btn
                  variant="primary"
                  disabled={busy || stopped || !text.trim()}
                  onClick={() => void send()}
                >
                  <Send className="size-4" aria-hidden="true" />
                  Envoyer au vrai agent
                </Btn>
                <Btn
                  disabled={busy || stopped || !!pending}
                  onClick={() =>
                    void guard(async () => {
                      try {
                        await api(`/simulation/${session.conversation_id}/run`, {
                          method: "POST",
                        });
                      } finally {
                        await refresh(session);
                      }
                    })
                  }
                >
                  Reprendre le traitement
                </Btn>
                <Btn
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void guard(() => refresh(session))}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Actualiser le bilan
                </Btn>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <section className="card card--default gap-3 p-5" aria-label="Boîte du prospect">
              <div className="flex items-center gap-2">
                <Inbox className="size-4 text-muted" aria-hidden="true" />
                <h2 className="text-base font-semibold text-foreground">Ce que voit le prospect simulé</h2>
              </div>
              {!report?.exchange.messages.length && (
                <p className="text-[13px] text-muted">Aucun message reçu.</p>
              )}
              {report?.exchange.messages.map((m) => (
                <p key={m.id} className="rounded-xl bg-surface-secondary px-3 py-2.5 text-[13px]/[20px] text-foreground">
                  <strong className="font-semibold">
                    {m.role === "prospect" ? "Camille" : "Message reçu"} :
                  </strong>{" "}
                  {m.content}
                </p>
              ))}
            </section>
            <section className="card card--default gap-4 p-5" aria-label="Bilan du parcours">
              <h2 className="text-base font-semibold text-foreground">Bilan observé</h2>
              <div className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">Informations mémorisées</h3>
                {profile.length ? (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
                    {profile.map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="text-muted">{label(PROFILE_FIELDS, key)}</dt>
                        <dd className="text-foreground">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-[13px] text-muted">Aucune information de qualification enregistrée.</p>
                )}
              </div>
              <p className="text-xs text-muted tabular-nums">
                Exécutions enregistrées : {runs.length} · Rendez-vous fictifs :{" "}
                {report?.appointments.length ?? 0}
              </p>
              {report?.appointments.map((a) => (
                <p key={a.id} className="flex items-start gap-2 text-[13px] text-foreground">
                  <CalendarCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <span>
                    Rendez-vous fictif le {formatDate(a.start_at)} —{" "}
                    {a.meeting_url ?? "sans lien"}
                  </span>
                </p>
              ))}
              {runs.length > 0 && (
                <div className="flex flex-col gap-2">
                  {runs.map((r) => (
                    <details key={r.run_id} className="group rounded-xl border border-separator">
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
                        {formatDate(r.started_at)} · {label(ACTIONS, r.action)}
                      </summary>
                      <div className="border-t border-separator px-3 py-3">
                        <RunView run={r} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
              {report?.model_validation && (
                <p className="text-[13px]/[20px] text-muted">{report.model_validation}</p>
              )}
              {!!report?.limits.length && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]/[20px] text-muted">
                  {report.limits.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </Screen>
  );
}
