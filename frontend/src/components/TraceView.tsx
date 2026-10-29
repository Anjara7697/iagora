import { ChevronRight, Sparkles } from "lucide-react";
import { ACTIONS, HANDOFF_REASONS, label } from "@/lib/labels";
import type { AgentRun } from "@/lib/types";
import { Tag } from "./ds/controls";
import { ScoreBadge, StageBadge } from "./ui";

/** Décision de l'agent, justification et trace des étapes du graphe (explicabilité, OB-05). */
export default function RunView({ run }: { run: AgentRun }) {
  return (
    <div data-ui="v2" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-lg bg-agent-soft text-agent" aria-hidden="true">
          <Sparkles className="size-3.5" />
        </span>
        <strong className="text-sm font-semibold text-foreground">{label(ACTIONS, run.action)}</strong>
        {run.handoff_reason && (
          <Tag tone="warning">{label(HANDOFF_REASONS, run.handoff_reason)}</Tag>
        )}
        {run.stage_after && <StageBadge stage={run.stage_after} />}
        {run.scores.total !== undefined && (
          <ScoreBadge total={run.scores.total} level={run.scores.level} />
        )}
      </div>
      <p className="text-[13px] text-muted">{run.reason}</p>
      <details className="group">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
          Trace ({run.trace.length} étapes)
        </summary>
        <ol className="mt-2 flex flex-col gap-1.5 border-l-2 border-separator pl-4">
          {run.trace.map((t, i) => (
            <li key={i} className="text-[13px] text-foreground">
              <code className="rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-xs">{t.node}</code> {t.summary}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">
          Modèle : {run.llm.provider}/{run.llm.model}
        </p>
      </details>
    </div>
  );
}
