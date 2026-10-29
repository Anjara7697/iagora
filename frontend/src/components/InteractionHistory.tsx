"use client";

import { useState } from "react";
import { Btn, TextLink } from "@/components/ds/controls";
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
    <section className="card card--default gap-0 p-0" aria-label="Historique des interactions">
      <div className="flex min-h-14 items-center border-b border-separator px-5 py-3">
        <h2 className="text-base font-semibold text-foreground">Interactions</h2>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        <Loading
          loading={history.loading}
          error={history.error}
          onRetry={history.reload}
        />
        {history.data?.total === 0 && (
          <p className="text-sm text-muted">Aucune interaction enregistrée.</p>
        )}
        <ul className="flex flex-col">
          {history.data?.items.map((item) => (
            <li key={item.id} className="flex gap-3 border-b border-separator py-3 last:border-b-0">
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${item.direction === "inbound" ? "bg-accent" : "bg-agent"}`}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-[13px] text-muted">
                  <strong className="font-semibold text-foreground">{TYPES[item.type] ?? item.type}</strong> ·{" "}
                  {formatDate(item.created_at)} ·{" "}
                  {item.direction === "inbound" ? "Entrant" : "Sortant"}
                </p>
                {item.content && (
                  <p className="text-sm whitespace-pre-wrap text-foreground">{item.content}</p>
                )}
                {item.conversation_ref && (
                  <TextLink
                    className="w-fit"
                    href={`/conversations?id=${encodeURIComponent(item.conversation_ref)}`}
                  >
                    Consulter l’échange
                  </TextLink>
                )}
              </div>
            </li>
          ))}
        </ul>
        {history.data && (history.data.total > LIMIT || offset > 0) && (
          <div className="flex items-center justify-between gap-2 border-t border-separator pt-3">
            <Btn
              size="sm"
              variant="ghost"
              disabled={offset === 0 || history.loading}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              Interactions précédentes
            </Btn>
            <span className="font-mono text-xs text-muted tabular-nums">
              {history.data.total === 0 ? 0 : offset + 1}–
              {Math.min(offset + LIMIT, history.data.total)} /{" "}
              {history.data.total}
            </span>
            <Btn
              size="sm"
              variant="ghost"
              disabled={offset + LIMIT >= history.data.total || history.loading}
              onClick={() => setOffset(offset + LIMIT)}
            >
              Interactions suivantes
            </Btn>
          </div>
        )}
      </div>
    </section>
  );
}
