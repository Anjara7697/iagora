"use client";

import { useEffect, useState } from "react";

/**
 * Valeur qui ne suit `value` qu'après `delay` ms sans changement (DATA-01) : une recherche tapée lettre par lettre
 * n'envoie qu'une requête, une fois la frappe arrêtée. Le champ, lui, affiche la saisie sans délai.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
