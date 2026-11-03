"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Évite de perdre une saisie : tant que `dirty` est vrai, `guard(action)` demande d'abord
 * « Abandonner les modifications ? » ; sans modification, l'action s'exécute directement.
 * Fermer l'onglet ou recharger la page déclenche aussi l'avertissement du navigateur.
 * `dialog` est à placer dans le rendu.
 */
export function useDiscardGuard(dirty: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const guard = (action: () => void) => {
    if (dirty) setPending(() => action);
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
