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
 * Apparition d'un bloc à l'entrée de la page : fondu et léger glissement vers le haut, décalé selon son rang.
 * À répartir sur `className` et `style` du composant : `<KpiCard {...reveal(2)} />`.
 */
export function reveal(index: number, step = 70): { className: string; style: CSSProperties } {
  return {
    className: "animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-backwards",
    style: { animationDelay: `${Math.min(index, 12) * step}ms` },
  };
}

/** Nombre qui monte jusqu'à sa valeur (et suit ses changements). Affiche la valeur finale si les animations sont réduites. */
export function CountUp({ value, duration = 900, suffix = "" }: { value: number; duration?: number; suffix?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    const origin = from.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(origin + (value - origin) * eased);
      from.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return (
    <span className="tabular-nums">
      {shown}
      {suffix}
    </span>
  );
}
