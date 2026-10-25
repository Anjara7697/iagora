"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { qs } from "@/lib/api";

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
    <nav className="profile-task-return" aria-label="Demande à traiter">
      <Link className="button-link" href={`/todo${qs({ id: task, kind: filter })}`}>
        ← Revenir à la demande
      </Link>
      <p>Consultez le contexte du prospect, puis revenez à la demande pour décider.</p>
    </nav>
  );
}
