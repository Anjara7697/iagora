"use client";

import Link from "next/link";
import { useCurrentUser } from "@/components/AppShell";
import { canUseSimulator } from "@/lib/access";
import { SIMULATOR_ENABLED } from "@/lib/api";

export default function TestingPage() {
  const user = useCurrentUser();
  if (!canUseSimulator(user?.role))
    return (
      <>
        <h1>Tests et démonstration</h1>
        <p className="card warnbox" role="alert">
          {!SIMULATOR_ENABLED
            ? "Le simulateur est désactivé sur cet environnement."
            : "Cet espace est réservé aux conseillers et aux administrateurs."}
        </p>
      </>
    );
  return (
    <>
      <Link className="profile-back" href="/settings">
        ← Paramètres
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Paramètres · Outils de test</span>
          <h1>Tests et démonstration</h1>
          <p className="muted">
            Préparez une démonstration ou vérifiez le comportement de l’agent
            avant de reprendre vos échanges.
          </p>
        </div>
      </div>
      <div className="demo-banner" role="note">
        <strong>Environnement de test — données fictives</strong>
        <p>
          Les essais utilisent le modèle, le mode et les réglages enregistrés de
          l’application. Les prospects et les échanges du simulateur sont
          fictifs.
        </p>
      </div>
      <section
        className="card testing-tool"
        aria-label="Simulateur de conversation"
      >
        <span className="eyebrow">Essayer l’agent</span>
        <h2>Simulateur de conversation</h2>
        <p>
          Jouez un prospect, suivez les décisions de l’agent et relisez ses
          réponses. Vous pouvez explorer librement ou choisir un parcours guidé.
        </p>
        <Link className="button-link primary-link" href="/simulator">
          Ouvrir le simulateur →
        </Link>
      </section>
    </>
  );
}
