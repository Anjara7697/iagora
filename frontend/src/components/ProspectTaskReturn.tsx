"use client";

import { useSearchParams } from "next/navigation";
import { qs } from "@/lib/api";
import { LinkButton } from "./ds/controls";

/** Retour explicite à la demande d’origine, même après une ouverture directe. */
export default function ProspectTaskReturn() {
  const params = useSearchParams();
  const task = params.get("task");
  if (!task) return null;
  const kind = params.get("kind");
  const filter = ["validation", "escalation", "kb_gap", "incident"].includes(
    kind ?? "",
  )
    ? kind
    : undefined;

  return (
    <nav
     
      className="flex flex-wrap items-center gap-3 rounded-xl bg-accent-soft px-4 py-3"
      aria-label="Demande à traiter"
    >
      <LinkButton size="sm" variant="primary" href={`/todo${qs({ id: task, kind: filter })}`}>
        ← Revenir à la demande
      </LinkButton>
      <p className="text-[13px] text-accent-soft-foreground">
        Consultez le contexte du prospect, puis revenez à la demande pour décider.
      </p>
    </nav>
  );
}
