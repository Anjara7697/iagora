"use client";

import { useSyncExternalStore } from "react";

/**
 * Vrai si la requête média correspond. `null` au rendu serveur et pendant l'hydratation : un écran qui en dépend
 * (vue par défaut, tableau ou lignes) attend la valeur réelle au lieu d'afficher puis de remplacer une autre vue.
 */
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore<boolean | null>(
    (notify) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}

/** Écran étroit (moins de 640 px) : les tableaux passent en lignes à deux niveaux (règle 4). */
export const NARROW = "(max-width: 639px)";
/** Grand écran (1024 px et plus) : assez de largeur pour un pipeline en colonnes. */
export const WIDE = "(min-width: 1024px)";
