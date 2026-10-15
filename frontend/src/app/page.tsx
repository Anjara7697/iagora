"use client";

import Link from "next/link";
import { useCurrentUser } from "@/components/AppShell";
import { SIMULATOR_ENABLED } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type {
  AgentMode,
  Campaign,
  ConversationSummary,
  Page,
  Prospect,
} from "@/lib/types";

const MODES: Record<AgentMode, string> = {
  assisted: "Assisté",
  auto: "Automatique",
  manual: "Arrêt d’urgence",
};

function Stat({
  title,
  value,
  href,
  hint,
}: {
  title: string;
  value: number | string | undefined;
  href?: string;
  hint?: string;
}) {
  const body = (
    <div className="card stat">
      <div className="stat-value">{value ?? "…"}</div>
      <div className="muted">{title}</div>
      {hint && <div className="muted">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="stat-link">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function Home() {
  const user = useCurrentUser();
  const prospects = useApi<Page<Prospect>>("/prospects?limit=1");
  const todo = useApi<{ total: number; counts: Record<string, number> }>(
    "/todo?limit=1",
  );
  const open = useApi<Page<ConversationSummary>>(
    "/conversations?status=open&limit=1",
  );
  const campaigns = useApi<Page<Campaign>>("/campaigns?status=active&limit=1");
  const mode = useApi<{ mode: AgentMode }>("/agent/mode");

  const failed = [prospects, todo, open, campaigns].filter((r) => r.error);
  const retry = () =>
    [prospects, todo, open, campaigns, mode].forEach((r) => r.reload());
  const value = <T,>(
    r: { data: T | null; error: unknown },
    pick: (d: T) => number | string,
  ) => (r.error ? "—" : r.data ? pick(r.data) : undefined);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Travail · Aujourd’hui</span>
          <h1>Aujourd’hui</h1>
          <p className="muted">
            Ce qui demande votre attention et l’état de l’activité.
          </p>
        </div>
      </div>
      {failed.length > 0 && (
        <p className="error" role="alert">
          Certains indicateurs sont indisponibles.{" "}
          <button onClick={retry}>Réessayer</button>
        </p>
      )}
      <div className="dash-grid">
        <Stat
          title="Brouillons à valider"
          value={value(todo, (d) => d.counts.validation ?? 0)}
          href="/todo"
        />
        <Stat
          title="Transferts à un conseiller"
          value={value(todo, (d) => d.counts.escalation ?? 0)}
          href="/todo"
        />
        <Stat
          title="Conversations ouvertes"
          value={value(open, (d) => d.total)}
          href="/conversations?status=open"
        />
        <Stat
          title="Prospects"
          value={value(prospects, (d) => d.total)}
          href="/prospects"
        />
        <Stat
          title="Campagnes actives"
          value={value(campaigns, (d) => d.total)}
          href="/campaigns"
        />
        <Stat
          title="Agent"
          value={
            mode.data ? MODES[mode.data.mode] : mode.error ? "—" : undefined
          }
          hint={user?.role === "VIEWER" ? undefined : "Réglable dans le menu"}
        />
      </div>
      <h2>Raccourcis</h2>
      <ul>
        <li>
          <Link href="/todo">À traiter</Link> : brouillons à valider,
          conversations remises à un conseiller, avec la fiche de transfert.
        </li>
        <li>
          <Link href="/conversations">Conversations</Link> : boîte de réception,
          prise de main et réponses.
        </li>
        <li>
          <Link href="/campaigns">Campagnes</Link> : programmes visés, sources
          et prospects de chaque campagne.
        </li>
        <li>
          <Link href="/knowledge">Base de connaissances</Link> : documents dans
          lesquels l’agent puise ses réponses.
        </li>
        {SIMULATOR_ENABLED && user?.role !== "VIEWER" && (
          <li>
            <Link href="/simulator">Simulateur</Link> : jouer un prospect fictif
            et voir l’agent répondre, avec sa trace (données de démonstration
            uniquement).
          </li>
        )}
      </ul>
    </>
  );
}
