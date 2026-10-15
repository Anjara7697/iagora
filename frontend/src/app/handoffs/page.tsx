"use client";

import { useState } from "react";
import { Loading, Pager, ProspectLink } from "@/components/ui";
import { HANDOFF_REASONS, formatDate, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { ConversationSummary, Page } from "@/lib/types";

const LIMIT = 20;

export default function HandoffsPage() {
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useApi<Page<ConversationSummary>>(
    `/conversations?status=handed_off&limit=${LIMIT}&offset=${offset}`,
  );

  return (
    <>
      <h1>Transferts à un conseiller</h1>
      <p className="muted">
        Conversations que l&apos;agent a remises à un humain (question hors base, situation sensible,
        demande du prospect…). La fiche contient tout ce qu&apos;il faut pour reprendre l&apos;échange.
      </p>
      <Loading loading={loading} error={error} />
      {data && data.items.length === 0 && <p>Aucun transfert en attente.</p>}
      {data?.items.map((c) => {
        const sheet = c.handoff;
        const who = sheet?.identity?.first_name || sheet?.identity?.email || `Prospect ${c.prospect_id}`;
        return (
          <div key={c.id} className="card">
            <div className="row">
              <strong>
                <ProspectLink id={c.prospect_id}>{who}</ProspectLink>
              </strong>
              <span className="badge warn">{label(HANDOFF_REASONS, sheet?.reason)}</span>
              <span className="spacer" />
              <span className="muted">{formatDate(c.last_message_at)}</span>
            </div>
            {sheet?.pending_question && (
              <p>
                <em>Question en attente :</em> « {sheet.pending_question} »
              </p>
            )}
            {sheet?.summary && <p className="muted">{sheet.summary}</p>}
            {sheet?.recommended_action && (
              <p>
                <strong>Action recommandée :</strong> {sheet.recommended_action}
              </p>
            )}
          </div>
        );
      })}
      {data && <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />}
    </>
  );
}
