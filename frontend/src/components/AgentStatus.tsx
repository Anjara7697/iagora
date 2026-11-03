"use client";

import { Button, Popover, toast } from "@heroui/react";
import { ChevronDown, OctagonX, Play } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { ErrorText } from "@/components/ds/controls";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { AgentMode } from "@/lib/types";

const COPY: Record<AgentMode, { short: string; title: string; text: string; dot: string; pulse: boolean }> = {
  assisted: {
    short: "Validation requise",
    title: "Agent — Validation requise",
    text: "L’agent prépare des brouillons ; rien n’est envoyé sans votre validation.",
    dot: "bg-success",
    pulse: true,
  },
  manual: {
    short: "Arrêté",
    title: "Agent — Arrêt d’urgence",
    text: "Réponses, relances et envois de l’agent suspendus, même déjà validés. Les conseillers peuvent répondre manuellement.",
    dot: "bg-danger",
    pulse: false,
  },
  auto: {
    short: "Automatique",
    title: "Agent — Mode automatique",
    text: "Les réponses de l’agent sont enregistrées sans validation.",
    dot: "bg-warning",
    pulse: true,
  },
};

const STOP = {
  title: "Arrêt d’urgence ?",
  description:
    "Les réponses, relances et envois de l’agent sont suspendus, y compris les messages déjà validés. Les conseillers peuvent toujours répondre manuellement. Un email déjà en cours de transmission ne peut pas être rappelé.",
  confirmLabel: "Arrêter l’agent",
};
const RESUME = {
  title: "Reprendre en mode assisté ?",
  description:
    "Les messages déjà validés pourront être envoyés si l’envoi est activé. Les anciens messages automatiques sans validation seront soumis à votre approbation.",
  confirmLabel: "Reprendre",
};

/**
 * État de l'agent, toujours visible dans la barre du haut (bureau et mobile). Le menu explique le mode et donne
 * l'arrêt d'urgence (ou la reprise), toujours après confirmation ; le résultat est confirmé par un Toast.
 */
export default function AgentStatus({ readOnly, refreshKey }: { readOnly: boolean; refreshKey: string }) {
  const { data, reload } = useApi<{ mode: AgentMode }>(`/agent/mode?k=${encodeURIComponent(refreshKey)}`);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<AgentMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const copy = COPY[data.mode];

  async function change(next: AgentMode) {
    setBusy(true);
    setError(null);
    try {
      await api("/agent/mode", { method: "PUT", body: { mode: next } });
      toast.success(next === "manual" ? "Agent arrêté" : "Agent repris en mode assisté", {
        description: next === "manual" ? "Plus aucune réponse, relance ni envoi automatique." : "Ses brouillons attendent de nouveau votre validation.",
      });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Changement de mode impossible");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const ask = (next: AgentMode) => {
    setOpen(false);
    setConfirm(next);
  };

  return (
    <>
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Button variant="tertiary" className="h-9 shrink-0 gap-2 px-2.5 sm:px-3" aria-label={`État de l’agent : ${copy.short}`}>
          <span className="relative inline-flex size-2 shrink-0" aria-hidden="true">
            {copy.pulse && (
              <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${copy.dot}`} />
            )}
            <span className={`relative inline-flex size-2 rounded-full ${copy.dot}`} />
          </span>
          <span className="hidden sm:inline">Agent : {copy.short.toLowerCase()}</span>
          <span className="sm:hidden">Agent</span>
          <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden="true" />
        </Button>
        <Popover.Content placement="bottom end" className="w-[300px]">
          <Popover.Dialog aria-label="État de l’agent" className="flex flex-col gap-3 p-4">
            <Popover.Heading className="text-sm font-semibold text-foreground">{copy.title}</Popover.Heading>
            <p className="text-[13px]/[19px] text-muted">{copy.text}</p>
            {error && <ErrorText>{error}</ErrorText>}
            {!readOnly &&
              (data.mode !== "manual" ? (
                <Button variant="danger-soft" fullWidth isDisabled={busy} onPress={() => ask("manual")}>
                  <OctagonX className="size-4" aria-hidden="true" />
                  Arrêt d’urgence
                </Button>
              ) : (
                <Button variant="tertiary" fullWidth isDisabled={busy} onPress={() => ask("assisted")}>
                  <Play className="size-4" aria-hidden="true" />
                  Reprendre en mode assisté
                </Button>
              ))}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      <ConfirmDialog
        isOpen={confirm !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirm(null);
        }}
        status={confirm === "manual" ? "danger" : "accent"}
        {...(confirm === "manual" ? STOP : RESUME)}
        onConfirm={() => {
          if (confirm) void change(confirm);
        }}
      />
    </>
  );
}
