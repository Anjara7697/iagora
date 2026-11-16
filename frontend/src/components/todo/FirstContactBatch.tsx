"use client";

/**
 * Validation groupée des premiers contacts affichés (décision D-29). Le conseiller en relit d'abord quelques-uns
 * (le détail s'ouvre comme pour toute demande), puis valide la page en une fois, après confirmation. Les envois
 * restent étalés et attendent la fenêtre d'envoi : rien ne part en rafale.
 */

import { toast } from "@heroui/react";
import { CheckCheck } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn } from "@/components/ds/controls";
import { api, failure } from "@/lib/api";
import type { BatchResult, TodoItem } from "@/lib/types";

export function FirstContactBatch({
  items,
  guard,
  onDone,
}: {
  items: TodoItem[];
  /** Protège une saisie en cours dans le détail (même garde que la navigation). */
  guard: (action: () => void) => void;
  onDone: () => void;
}) {
  const user = useCurrentUser();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const drafts = items.filter((i) => i.kind === "first_contact" && i.draft);
  if (!drafts.length || user?.role === "VIEWER") return null;
  const n = drafts.length;
  const plural = n > 1 ? "s" : "";

  async function approve() {
    setBusy(true);
    try {
      const result = await api<BatchResult>("/todo/first-contacts/approve", {
        method: "POST",
        body: { drafts: drafts.map((i) => ({ conversation_id: i.conversation_id, message_id: i.draft!.message_id })) },
      });
      toast.success(`${result.approved} premier${result.approved > 1 ? "s" : ""} contact${result.approved > 1 ? "s" : ""} validé${result.approved > 1 ? "s" : ""}`, {
        description: result.skipped
          ? `${result.skipped} ignoré${result.skipped > 1 ? "s" : ""} : déjà traité${result.skipped > 1 ? "s" : ""} ou devenu${result.skipped > 1 ? "s" : ""} non éligible${result.skipped > 1 ? "s" : ""}.`
          : "Ils partiront dans la fenêtre d’envoi, étalés par lots de cinq par minute.",
      });
      onDone();
    } catch (e) {
      toast.danger(failure("Validation des premiers contacts impossible", e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <Btn variant="secondary" className="w-full" isDisabled={busy} onClick={() => guard(() => setConfirming(true))}>
        <CheckCheck className="size-4" aria-hidden="true" />
        Valider les {n} premier{plural} contact{plural} affiché{plural}
      </Btn>
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        status="warning"
        title={`Valider ${n} premier${plural} contact${plural} ?`}
        description={`Chaque message partira tel qu’il est écrit. Ouvrez-en quelques-uns avant pour vérifier le ton et les informations. Les envois attendent la fenêtre d’envoi des Paramètres et sont étalés (cinq par minute).`}
        cancelLabel="Relire d’abord"
        confirmLabel={`Valider les ${n}`}
        confirmDisabled={busy}
        onConfirm={() => void approve()}
      />
    </>
  );
}
