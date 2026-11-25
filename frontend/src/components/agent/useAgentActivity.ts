"use client";

import { useEffect, useRef } from "react";
import { isBusy, pollDelay } from "@/lib/agentActivity";
import type { AgentActivity, AgentActivityItem } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** Relit l'activité d'une conversation ; `onFinished` est appelé quand un traitement se termine (brouillon prêt). */
export function useAgentActivity(conversationId: string, onFinished?: () => void) {
  const activity = useApi<AgentActivity | null>(`/conversations/${conversationId}/agent-activity`, { keepPrevious: true });
  usePolling(activity.reload, pollDelay(activity.data));
  const wasBusy = useRef(false);
  const busy = isBusy(activity.data);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  useEffect(() => {
    if (wasBusy.current && !busy) finished.current?.();
    wasBusy.current = busy;
  }, [busy]);
  return activity;
}

/** Relance `reload` à intervalle régulier, en pause quand l'onglet est masqué. */
export function usePolling(reload: () => void, ms: number) {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") reload();
    };
    const timer = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload, ms]);
}

/** Conversations où l'agent travaille ou attend, dans le périmètre de l'utilisateur. */
export function useCurrentActivity(enabled = true) {
  const current = useApi<AgentActivityItem[]>(enabled ? "/agent/activity" : null, { keepPrevious: true });
  const fast = current.data?.some((a) => pollDelay(a) < 5000) ?? false;
  usePolling(current.reload, fast ? 3000 : 15000);
  return current;
}
