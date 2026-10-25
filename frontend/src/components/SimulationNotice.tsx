import Link from "next/link";
import type { ReactNode } from "react";

export default function SimulationNotice({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="simulation-context">
      <Link className="profile-back" href="/settings/testing">
        ← Tests et démonstration
      </Link>
      <div className="demo-banner" role="note">
        <strong>Environnement de test — données fictives</strong>
        <p>{children}</p>
        <p className="simulation-shared-note">
          Les réglages et le mode de l’agent sont partagés avec l’application.
        </p>
      </div>
    </div>
  );
}
