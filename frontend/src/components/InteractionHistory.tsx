"use client";

import Link from "next/link";
import { useState } from "react";
import { Loading } from "@/components/ui";
import { formatDate } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Page } from "@/lib/types";

type Interaction = {
  id: number;
  type: string;
  direction: string;
  content: string | null;
  conversation_ref: string | null;
  created_at: string;
};

const TYPES: Record<string, string> = {
  message: "Message",
  email: "Email",
  form_submission: "Formulaire",
  campaign_attributed: "Attribution à une campagne",
  consent: "Consentement",
  opt_out: "Désinscription",
};
const LIMIT = 20;

export default function InteractionHistory({ id }: { id: number }) {
  const [offset, setOffset] = useState(0);
  const history = useApi<Page<Interaction>>(
    `/prospects/${id}/interactions?limit=${LIMIT}&offset=${offset}`,
  );
  return (
    <section className="ui-card" aria-label="Historique des interactions">
      <h2>Interactions</h2>
      <Loading
        loading={history.loading}
        error={history.error}
        onRetry={history.reload}
      />
      {history.data?.total === 0 && (
        <p className="muted">Aucune interaction enregistrée.</p>
      )}
      <ul className="trace">
        {history.data?.items.map((item) => (
          <li key={item.id}>
            <strong>{TYPES[item.type] ?? item.type}</strong> ·{" "}
            {formatDate(item.created_at)} ·{" "}
            {item.direction === "inbound" ? "Entrant" : "Sortant"}
            {item.content && (
              <p className="interaction-content">{item.content}</p>
            )}
            {item.conversation_ref && (
              <Link
                href={`/conversations?id=${encodeURIComponent(item.conversation_ref)}`}
              >
                Consulter l’échange
              </Link>
            )}
          </li>
        ))}
      </ul>
      {history.data && (history.data.total > LIMIT || offset > 0) && (
        <div className="pager">
          <button
            disabled={offset === 0 || history.loading}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            Interactions précédentes
          </button>
          <span>
            {history.data.total === 0 ? 0 : offset + 1}–
            {Math.min(offset + LIMIT, history.data.total)} /{" "}
            {history.data.total}
          </span>
          <button
            disabled={offset + LIMIT >= history.data.total || history.loading}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Interactions suivantes
          </button>
        </div>
      )}
    </section>
  );
}
