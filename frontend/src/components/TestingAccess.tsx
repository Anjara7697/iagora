"use client";

import Link from "next/link";
import { useCurrentUser } from "./AppShell";
import { canUseSimulator } from "@/lib/access";

export default function TestingAccess({
  disabled = false,
  unsaved = false,
}: {
  disabled?: boolean;
  unsaved?: boolean;
}) {
  const user = useCurrentUser();
  if (!canUseSimulator(user?.role)) return null;
  return (
    <section
      className="card testing-access"
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
