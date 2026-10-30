import { FlaskConical } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** Bandeau des écrans de test : retour à « Tests et démonstration » et rappel des données fictives. */
export default function SimulationNotice({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        className="w-fit rounded text-sm font-medium text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
        href="/settings/testing"
      >
        ← Tests et démonstration
      </Link>
      <div
        className="flex items-start gap-3 rounded-2xl border border-dashed border-agent/40 bg-agent-soft/60 px-4 py-3"
        role="note"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-agent-soft text-agent" aria-hidden="true">
          <FlaskConical className="size-4" />
        </span>
        <div className="flex flex-col gap-1 text-[13px]/[20px] text-foreground">
          <strong className="text-sm font-semibold">Environnement de test — données fictives</strong>
          <p>{children}</p>
          <p className="text-muted">Les réglages et le mode de l’agent sont partagés avec l’application.</p>
        </div>
      </div>
    </div>
  );
}
