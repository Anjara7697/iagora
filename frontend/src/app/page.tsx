"use client";

import Link from "next/link";
import { useApi } from "@/lib/useApi";
import type { Campaign, ConversationSummary, Page, Prospect } from "@/lib/types";
import { SIMULATOR_ENABLED } from "@/lib/api";

function Stat({ title, value, href }: { title: string; value: number | undefined; href?: string }) {
  const body = (
    <div className="card stat">
      <div className="stat-value">{value ?? "…"}</div>
      <div className="muted">{title}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function Home() {
  const prospects = useApi<Page<Prospect>>("/prospects?limit=1");
  const handoffs = useApi<Page<ConversationSummary>>("/conversations?status=handed_off&limit=1");
  const open = useApi<Page<ConversationSummary>>("/conversations?status=open&limit=1");
  const campaigns = useApi<Page<Campaign>>("/campaigns?limit=1");

  return (
    <>
      <h1>Accueil</h1>
      <div className="grid">
        <Stat title="Prospects" value={prospects.data?.total} href="/prospects" />
        <Stat title="Conversations ouvertes" value={open.data?.total} />
        <Stat title="À traiter par un conseiller" value={handoffs.data?.total} href="/handoffs" />
        <Stat title="Campagnes" value={campaigns.data?.total} />
      </div>
      <h2>Pour démarrer</h2>
      <ul>
        <li>
          <Link href="/prospects">Prospects</Link> : étape, score et historique de chaque prospect, conversation
          et décisions de l&apos;agent.
        </li>
        <li>
          <Link href="/handoffs">Transferts</Link> : conversations remises à un conseiller, avec la fiche de
          transfert.
        </li>
        {SIMULATOR_ENABLED && (
          <li>
            <Link href="/simulator">Simulateur</Link> : jouer un prospect fictif et voir l&apos;agent
            répondre, avec sa trace.
          </li>
        )}
      </ul>
    </>
  );
}
