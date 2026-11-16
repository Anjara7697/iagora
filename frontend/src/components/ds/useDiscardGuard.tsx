"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Évite de perdre une saisie : tant que `isDirty()` est vrai, `guard(action)` demande d'abord
 * « Abandonner les modifications ? » ; sans modification, l'action s'exécute directement.
 * Fermer l'onglet ou recharger la page déclenche aussi l'avertissement du navigateur, et un clic sur un
 * lien interne (menu latéral) passe par le même dialogue avant de quitter l'écran (AUDIT-FE-001).
 * `isDirty` est lu au moment de quitter (pas au dernier rendu) : une touche Échap juste après la frappe est couverte.
 * `dialog` est à placer dans le rendu.
 */
export function useDiscardGuard(isDirty: () => boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const latest = useRef(isDirty);
  useLayoutEffect(() => {
    latest.current = isDirty;
  });

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current()) event.preventDefault();
    };
    // Liens internes (menu latéral, fil d'Ariane…) : la navigation de Next.js ne passe pas par
    // `beforeunload`. Le clic est intercepté avant React (phase de capture) et soumis au même dialogue.
    const intercept = (event: MouseEvent) => {
      if (!latest.current() || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Même écran (section, onglet, élément sélectionné) : la page gère elle-même ses changements.
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => router.push(url.pathname + url.search + url.hash));
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
    };
  }, [router]);

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
