"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Évite de perdre une saisie : tant que `isDirty()` est vrai, `guard(action)` demande d'abord
 * « Abandonner les modifications ? » ; sans modification, l'action s'exécute directement.
 * Fermer l'onglet ou recharger la page déclenche aussi l'avertissement du navigateur.
 * `isDirty` est lu au moment de quitter (pas au dernier rendu) : une touche Échap juste après la frappe est couverte.
 * `dialog` est à placer dans le rendu.
 */
export function useDiscardGuard(isDirty: () => boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const latest = useRef(isDirty);
  useLayoutEffect(() => {
    latest.current = isDirty;
  });

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const guard = (action: () => void) => {
    if (latest.current()) setPending(() => action);
    else action();
  };

  const dialog = (
    <ConfirmDialog
      isOpen={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title="Abandonner les modifications ?"
      description="Les changements non enregistrés seront perdus."
      cancelLabel="Continuer la saisie"
      confirmLabel="Abandonner"
      onConfirm={() => pending?.()}
    />
  );

  return { guard, dialog };
}
