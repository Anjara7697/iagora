"use client";

import { useEffect, useState } from "react";
import { isAbort } from "./api";
import { sharedGet } from "./sharedGet";
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
    // Même adresse que l'accueil : une seule requête quand les deux la demandent ensemble (`sharedGet`).
    let release = () => {};
    const refresh = (fresh: boolean) => {
      release();
      const request = sharedGet<{ total: number }>("/todo?limit=1", { fresh });
      release = request.release;
      let current = true;
      const previous = release;
      release = () => {
        current = false;
        previous();
      };
      request.promise
        .then((page) => {
          if (current) setWaiting(page.total);
        })
        .catch((error: unknown) => {
          if (current && !isAbort(error)) setWaiting(null);
        });
    };
    const onChange = () => refresh(true);
    refresh(false);
    window.addEventListener(WORK_QUEUE_CHANGED, onChange);
    return () => {
      release();
      window.removeEventListener(WORK_QUEUE_CHANGED, onChange);
    };
  }, [user, pathname]);
  return waiting;
}
