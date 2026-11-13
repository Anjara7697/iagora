"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { User } from "./types";
import { WORK_QUEUE_CHANGED } from "./workQueue";

/**
 * Nombre d'éléments à traiter (barre du haut et menu) : brouillons, transferts, incidents. Rechargé à chaque
 * changement d'écran et après chaque décision ; `null` tant qu'il n'est pas connu ou en cas d'échec.
 */
export function useWorkQueueCount(user: User | null, pathname: string): number | null {
  const [waiting, setWaiting] = useState<number | null>(null);
  useEffect(() => {
    if (!user || user.must_change_password) return;
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      api<{ total: number }>("/todo?limit=1")
        .then((page) => {
          if (active && current === request) setWaiting(page.total);
        })
        .catch(() => {
          if (active && current === request) setWaiting(null);
        });
    };
    refresh();
    window.addEventListener(WORK_QUEUE_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(WORK_QUEUE_CHANGED, refresh);
    };
  }, [user, pathname]);
  return waiting;
}
