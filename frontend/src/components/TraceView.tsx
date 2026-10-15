import { ACTIONS, HANDOFF_REASONS, label } from "@/lib/labels";
import type { AgentRun } from "@/lib/types";
import { ScoreBadge, StageBadge } from "./ui";

/** Décision de l'agent, justification et trace des étapes du graphe (explicabilité, OB-05). */
export default function RunView({ run }: { run: AgentRun }) {
  return (
    <div className="run">
      <div className="run-head">
        <strong>{label(ACTIONS, run.action)}</strong>
        {run.handoff_reason && (
          <span className="badge warn">{label(HANDOFF_REASONS, run.handoff_reason)}</span>
        )}
        {run.stage_after && <StageBadge stage={run.stage_after} />}
        {run.scores.total !== undefined && (
          <ScoreBadge total={run.scores.total} level={run.scores.level} />
        )}
      </div>
      <p className="muted">{run.reason}</p>
      <details>
        <summary>Trace ({run.trace.length} étapes)</summary>
        <ol className="trace">
          {run.trace.map((t, i) => (
            <li key={i}>
              <code>{t.node}</code> {t.summary}
            </li>
          ))}
        </ol>
        <p className="muted">
          Modèle : {run.llm.provider}/{run.llm.model}
        </p>
      </details>
    </div>
  );
}
