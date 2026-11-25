"use client";

/**
 * Journal en direct de l'agent pour une conversation : ce qu'il fait à l'instant, étape par étape (✓ faite, en cours),
 * ou ce qu'il attend (regroupement des emails, mode manuel, nouvel essai). Libellés fixes du serveur et nombres
 * seulement : la trace complète reste dans « Décisions de l'agent ».
 */

import { CircleAlert, CircleCheck, Hourglass, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Box } from "@/components/ds/card";
import { Tag, TextLink } from "@/components/ds/controls";
import { cx, EmptyText } from "@/components/ds/layout";
import { activityTag, activityTitle, currentStep, shortDuration } from "@/lib/agentActivity";
import { fullName, relativeTime } from "@/lib/labels";
import type { AgentActivity, AgentActivityItem } from "@/lib/types";

/** Horloge locale pour faire avancer les durées entre deux relectures. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

export function AgentActivityCard({ activity, className }: { activity: AgentActivity; className?: string }) {
  const live = activity.state !== "done" && activity.state !== "failed";
  const now = useNow(live);
  const running = activity.state === "running";
  const warning = activity.state === "retrying" || activity.state === "stalled" || activity.state === "failed";
  const steps = activity.steps ?? [];
  const Icon = warning ? CircleAlert : running ? Sparkles : activity.state === "done" ? CircleCheck : Hourglass;

  return (
    <Box as="section" aria-label="Activité de l’agent en direct" className={cx("gap-3 p-5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cx(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
            warning ? "bg-warning-soft text-warning" : "bg-agent-soft text-agent",
          )}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <h3 className="min-w-0 flex-1 type-body font-semibold text-foreground" aria-live="polite">
          {activityTitle(activity, now)}
        </h3>
        {running && activity.started_at && (
          <span className="shrink-0 type-caption text-muted">depuis {shortDuration(now - ms(activity.started_at))}</span>
        )}
        {activity.state === "done" && activity.finished_at && (
          <Tag tone="success">Terminé {relativeTime(activity.finished_at, now)}</Tag>
        )}
      </div>
      {steps.length > 0 && (
        <ol className="flex flex-col gap-1.5 border-l-2 border-separator pl-4" aria-label="Étapes">
          {steps.map((s, i) => {
            const done = s.status === "done";
            const end = done ? ms(s.finished_at) : now;
            return (
              <li key={`${s.node}-${i}`} className="flex items-start gap-2 type-body-sm">
                {done ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-agent motion-reduce:animate-none" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={done ? "text-foreground" : "font-semibold text-foreground"}>{s.label}</span>
                  {s.detail && <span className="text-muted"> · {s.detail}</span>}
                  <span className="sr-only">{done ? " (fait)" : " (en cours)"}</span>
                </span>
                <span className="shrink-0 type-caption tabular-nums text-muted">
                  {shortDuration(Math.max(0, end - ms(s.started_at)))}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {(activity.state === "done" || activity.state === "failed") && (
        <p className="type-caption text-muted">
          La décision complète et sa justification restent dans la fiche du prospect, onglet « Décisions de l’agent ».
        </p>
      )}
    </Box>
  );
}

/** Page Agent, « En cours maintenant » : chaque conversation où l'agent travaille ou attend, avec un lien vers elle. */
export function CurrentActivityList({ items }: { items: AgentActivityItem[] }) {
  const now = useNow(items.length > 0);
  if (items.length === 0) return <EmptyText>L’agent ne traite rien en ce moment.</EmptyText>;
  return (
    <ul className="flex flex-col divide-y divide-separator">
      {items.map((a) => {
        const name = a.prospect
          ? fullName({ first_name: a.prospect.first_name ?? null, last_name: a.prospect.last_name ?? null, email: a.prospect.email ?? null })
          : `Prospect ${a.prospect_id}`;
        const step = currentStep(a);
        const warning = a.state === "retrying" || a.state === "stalled";
        return (
          <li key={a.conversation_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <TextLink href={`/conversations?id=${encodeURIComponent(a.conversation_id)}`} className="truncate type-body font-semibold">
                {name}
              </TextLink>
              <span className="type-body-sm text-muted">{step ? step.label : activityTitle(a, now)}</span>
            </span>
            <Tag tone={warning ? "warning" : "agent"}>{activityTag(a)}</Tag>
            {a.state === "running" && a.started_at && (
              <span className="shrink-0 type-caption tabular-nums text-muted">{shortDuration(now - ms(a.started_at))}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
