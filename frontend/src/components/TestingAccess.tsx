"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { Btn, LinkButton } from "./ds/controls";
import { useCurrentUser } from "./AppShell";
import { canUseSimulator } from "@/lib/access";

export default function TestingAccess({
  disabled = false,
  unsaved = false,
  compact = false,
}: {
  disabled?: boolean;
  unsaved?: boolean;
  /** Entrée de la navigation latérale des Paramètres plutôt qu'une carte. */
  compact?: boolean;
}) {
  const user = useCurrentUser();
  if (!canUseSimulator(user?.role)) return null;
  if (compact)
    return disabled || unsaved ? (
      <span className="flex cursor-not-allowed items-start gap-3 rounded-xl px-3 py-2.5 opacity-70" aria-disabled="true">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="flex flex-col">
          <span className="text-sm font-medium text-foreground">Tests et démonstration</span>
          <small className="text-xs text-muted">
            {unsaved ? "Enregistrez d’abord vos modifications" : "Simulateur, prospects fictifs"}
          </small>
        </span>
      </span>
    ) : (
      <Link
        href="/settings/testing"
        className="flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-default/60 focus-visible:ring-2 focus-visible:ring-focus"
      >
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-agent" aria-hidden="true" />
        <span className="flex flex-col">
          <span className="text-sm font-medium text-foreground">Tests et démonstration</span>
          <small className="text-xs text-muted">Simulateur, prospects fictifs</small>
        </span>
      </Link>
    );
  return (
    <section
      data-ui="v2"
      className="card card--default flex-row flex-wrap items-center gap-4 p-5"
      aria-label="Tests et démonstration"
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-agent-soft text-agent" aria-hidden="true">
        <FlaskConical className="size-5" />
      </span>
      <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
        <h2 className="text-base font-semibold text-foreground">Tests et démonstration</h2>
        <p className="text-[13px]/[20px] text-muted">
          Essayez le comportement de l’agent avec des prospects fictifs et les
          réglages enregistrés.
        </p>
        {unsaved && (
          <p className="text-xs text-warning-soft-foreground">
            Enregistrez vos modifications avant de les tester.
          </p>
        )}
      </div>
      {disabled || unsaved ? (
        <Btn disabled>Ouvrir l’espace de test</Btn>
      ) : (
        <LinkButton variant="outline" href="/settings/testing">
          Ouvrir l’espace de test →
        </LinkButton>
      )}
    </section>
  );
}
