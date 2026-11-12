"use client";

import { Sparkles } from "lucide-react";
import RunView from "@/components/TraceView";
import { Box } from "@/components/ds/card";
import { FilterChip } from "@/components/ds/controls";
import { STAGES, label } from "@/lib/labels";
import type { AgentRun, Message } from "@/lib/types";

/** Colonne « Décision de l'agent » du simulateur : tour affiché, trace, scores, étape, sources et confiance. */
export function AgentDecision({
  runs,
  current,
  onShow,
  lastAgent,
}: {
  runs: AgentRun[];
  current: AgentRun | undefined;
  onShow: (index: number) => void;
  /** Dernier message de l'agent : ses sources et sa confiance valent pour le dernier tour seulement. */
  lastAgent: Message | undefined;
}) {
  const lastRun = runs[runs.length - 1];
  const sources = Array.isArray(lastAgent?.metadata.sources) ? (lastAgent?.metadata.sources as string[]) : [];
  const confidence =
    typeof lastAgent?.metadata.confidence === "number" ? (lastAgent.metadata.confidence as number) : null;
  return (
    <Box as="aside" className="gap-4 p-5" aria-label="Décision de l'agent">
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
                  onClick={() => onShow(i)}
                >
                  Tour {i + 1}
                </FilterChip>
              ))}
            </div>
          )}
          <RunView run={current} />
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-separator pt-4 text-[13px]">
            <dt className="text-muted">Intérêt / adéquation</dt>
            <dd className="text-foreground tabular-nums">
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
                <dd className="text-foreground tabular-nums">
                  {confidence !== null
                    ? `${Math.round(confidence * 100)} %`
                    : "-"}
                </dd>
              </>
            )}
          </dl>
        </>
      )}
    </Box>
  );
}
