"use client";

import Link from "next/link";
import { useState } from "react";
import ConversationView from "@/components/ConversationView";
import RunView from "@/components/TraceView";
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
    conversation?.status === "closed" || conversation?.status === "handed_off";

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

  return (
    <div className="guided-simulator">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Banc d’essai · parcours guidé</span>
          <h1>De la qualification au rendez-vous</h1>
          <p>
            Vous jouez Camille, titulaire d’un Bac+3 en informatique, qui
            souhaite devenir data analyst en alternance.
          </p>
        </div>
        <button disabled={busy} onClick={onBack}>
          Retour au simulateur libre
        </button>
      </div>
      <div className="demo-banner" role="note">
        Agent et modèle configurés réels ; campagne, documents, boîte email et
        calendrier fictifs. Aucun email externe. Le rendez-vous réservé reste
        fictif et ne vaut pas conversion.
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!session && (
        <section className="card">
          <h2>Premier parcours</h2>
          <p>
            Présentez votre besoin, précisez votre profil, exprimez une
            objection puis demandez un rendez-vous. En mode assisté, validez
            chaque brouillon avant de jouer la réponse du prospect.
          </p>
          <p>
            Les documents de test couvrent la durée, l’alternance et
            l’accompagnement. Le prix et le financement sont volontairement
            inconnus.
          </p>
          <button
            className="primary"
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
            Démarrer le parcours guidé
          </button>
        </section>
      )}
      {session && (
        <>
          <section className="card" aria-label="Guide du parcours">
            <h2>Messages suggérés</h2>
            <p>
              Adaptez-les aux réponses de l’agent ; un clic prépare le message
              sans l’envoyer.
            </p>
            <ol>
              {session.guide.map((message, i) => (
                <li key={message}>
                  <button
                    disabled={busy || stopped}
                    onClick={() => setText(message)}
                  >
                    Étape {i + 1} : {message}
                  </button>
                </li>
              ))}
            </ol>
            <Link href={`/prospects/${session.prospect_id}`}>
              Voir le prospect fictif et son suivi
            </Link>
          </section>
          <section className="card" aria-label="Échange opérateur">
            <h2>Échange et brouillons</h2>
            <ConversationView
              messages={conversation?.messages ?? []}
              prospectName="Camille"
              channel="email"
            />
            {pending && (
              <div className="warnbox" role="status">
                Brouillon invisible pour le prospect tant qu’il n’est pas
                validé.
                <div className="row">
                  <button
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
                    Valider et livrer dans la boîte fictive
                  </button>
                  <button
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
                    Refuser le brouillon
                  </button>
                </div>
              </div>
            )}
            {stopped && (
              <p role="status">
                Parcours arrêté : conversation{" "}
                {conversation?.status === "handed_off"
                  ? "transférée au conseiller"
                  : "clôturée"}
                .
              </p>
            )}
            <label className="guided-composer">
              Message du prospect
              <textarea
                value={text}
                disabled={busy || stopped}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="row">
              <button
                className="primary"
                disabled={busy || stopped || !text.trim()}
                onClick={() => void send()}
              >
                Envoyer au vrai agent
              </button>
              <button
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
              </button>
              <button
                disabled={busy}
                onClick={() => void guard(() => refresh(session))}
              >
                Actualiser le bilan
              </button>
            </div>
          </section>
          <section className="card" aria-label="Boîte du prospect">
            <h2>Ce que voit le prospect simulé</h2>
            {!report?.exchange.messages.length && <p>Aucun message reçu.</p>}
            {report?.exchange.messages.map((m) => (
              <p key={m.id}>
                <strong>
                  {m.role === "prospect" ? "Camille" : "Message reçu"} :
                </strong>{" "}
                {m.content}
              </p>
            ))}
          </section>
          <section className="card" aria-label="Bilan du parcours">
            <h2>Bilan observé</h2>
            <h3>Informations mémorisées</h3>
            {Object.keys(prospect?.profile ?? {}).length ? (
              <dl>
                {Object.entries(prospect?.profile ?? {}).map(([key, value]) => (
                  <div key={key}>
                    <dt>{label(PROFILE_FIELDS, key)}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>Aucune information de qualification enregistrée.</p>
            )}
            <p>
              Exécutions enregistrées : {runs.length} · Rendez-vous fictifs :{" "}
              {report?.appointments.length ?? 0}
            </p>
            {report?.appointments.map((a) => (
              <p key={a.id}>
                Rendez-vous fictif le {formatDate(a.start_at)} —{" "}
                {a.meeting_url ?? "sans lien"}
              </p>
            ))}
            {runs.map((r) => (
              <details key={r.run_id}>
                <summary>
                  {formatDate(r.started_at)} · {label(ACTIONS, r.action)}
                </summary>
                <RunView run={r} />
              </details>
            ))}
            <p>{report?.model_validation}</p>
            <ul>
              {report?.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
