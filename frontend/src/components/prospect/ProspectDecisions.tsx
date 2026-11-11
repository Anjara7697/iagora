"use client";

import { Bot } from "lucide-react";
import RunView from "@/components/TraceView";
import { EmptyPanel, cx } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Loading } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { AgentRun } from "@/lib/types";

/** Onglet « Décisions de l'agent » : chaque exécution, sa justification, sa trace et la réponse rédigée. */
export default function ProspectDecisions({
  runs,
  loading,
  error,
  onRetry,
}: {
  runs: AgentRun[] | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
}) {
  return (
    <section aria-label="Décisions de l’agent" className="flex flex-col gap-4">
      <Loading loading={loading} error={error} onRetry={onRetry} />
      {runs?.length === 0 && (
        <EmptyPanel icon={Bot} title="Aucune décision" description="L’agent n’a pas encore traité ce prospect." />
      )}
      {runs?.map((r, index) => (
        <article
          key={r.run_id}
          aria-label={`Décision du ${formatDate(r.started_at)}`}
          className={cx("flex flex-col gap-2 rounded-lg border border-separator bg-surface p-4", reveal(index + 1).className)}
          style={reveal(index + 1).style}
        >
          <div className="text-xs text-muted tabular-nums">{formatDate(r.started_at)}</div>
          <RunView run={r} />
          {r.reply && (
            <blockquote className="rounded-lg border-l-2 border-agent/40 bg-surface-secondary px-4 py-3 text-sm whitespace-pre-wrap text-foreground">
              {r.reply}
            </blockquote>
          )}
        </article>
      ))}
    </section>
  );
}
