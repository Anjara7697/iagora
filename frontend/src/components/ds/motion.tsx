"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Vrai quand l'utilisateur demande moins d'animations (faux côté serveur). */
export function useReducedMotion() {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(QUERY);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Apparition à l'entrée de l'écran (UI-10) : un fondu de 150 ms, le même pour tous les blocs, sans décalage ni
 * glissement (l'ancienne cascade retardait la lecture du dernier bloc de près d'une seconde à chaque visite).
 * Le rang est gardé dans la signature pour ne pas toucher les écrans. Désactivé quand l'utilisateur demande moins
 * de mouvement (`heroui.css`).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function reveal(index = 0, step = 0): { className: string; style: CSSProperties } {
  return { className: "animate-in fade-in duration-150", style: {} };
}

/** Nombre qui monte jusqu'à sa valeur (et suit ses changements). Affiche la valeur finale si les animations sont réduites. */
export function CountUp({ value, duration = 700, suffix = "", decimals = 0 }: { value: number; duration?: number; suffix?: string; decimals?: number }) {
  const reduced = useReducedMotion();
  const scale = 10 ** decimals;
  const target = Math.round(value * scale);
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (reduced) {
      from.current = target;
      setShown(target);
      return;
    }
    const origin = from.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(origin + (target - origin) * eased);
      from.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced]);

  return (
    <span className="tabular-nums">
      {decimals > 0 ? (shown / scale).toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : shown}
      {suffix}
    </span>
  );
}
