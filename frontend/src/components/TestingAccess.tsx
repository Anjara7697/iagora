"use client";

import Link from "next/link";
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
      <span className="settings-nav-item" aria-disabled="true">
        <span>Tests et démonstration</span>
        <small>
          {unsaved
            ? "Enregistrez d’abord vos modifications"
            : "Simulateur, prospects fictifs"}
        </small>
      </span>
    ) : (
      <Link href="/settings/testing" className="settings-nav-item">
        <span>Tests et démonstration</span>
        <small>Simulateur, prospects fictifs</small>
      </Link>
    );
  return (
    <section
      className="ui-card testing-access"
      aria-label="Tests et démonstration"
    >
      <div>
        <h2>Tests et démonstration</h2>
        <p className="muted">
          Essayez le comportement de l’agent avec des prospects fictifs et les
          réglages enregistrés.
        </p>
        {unsaved && (
          <p className="field-note">
            Enregistrez vos modifications avant de les tester.
          </p>
        )}
      </div>
      {disabled || unsaved ? (
        <button disabled>Ouvrir l’espace de test</button>
      ) : (
        <Link className="button-link" href="/settings/testing">
          Ouvrir l’espace de test →
        </Link>
      )}
    </section>
  );
}
