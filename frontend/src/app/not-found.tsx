import { MapPinOff } from "lucide-react";
import type { Metadata } from "next";
import { LinkButton } from "@/components/ds/controls";
import { Screen } from "@/components/ds/layout";

export const metadata: Metadata = { title: "Page introuvable" };

/** Adresse inconnue (ARCH-02) : dans la console, avec le menu, et un retour à l'accueil. */
export default function NotFound() {
  return (
    <Screen>
      <section className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-lg bg-surface-secondary text-muted" aria-hidden="true">
          <MapPinOff className="size-5" />
        </span>
        <div className="flex max-w-sm flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">Page introuvable</h1>
          <p className="text-sm text-muted">
            Cette adresse ne correspond à aucun écran de la console. Elle a peut-être été mal recopiée.
          </p>
        </div>
        <LinkButton href="/" variant="primary">
          Revenir à Aujourd’hui
        </LinkButton>
      </section>
    </Screen>
  );
}
