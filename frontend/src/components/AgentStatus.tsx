"use client";

import { Button, toast } from "@heroui/react";
import { Bot, OctagonX, Play } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { AgentMode } from "@/lib/types";

export const AGENT_COPY: Record<AgentMode, { short: string; text: string; dot: string; tone: string; pulse: boolean }> = {
  assisted: {
    short: "Validation requise",
    text: "Prépare des brouillons ; rien n’est envoyé sans votre validation.",
    dot: "bg-success",
    tone: "text-success-soft-foreground",
    pulse: true,
  },
  manual: {
    short: "Arrêté",
    text: "Réponses, relances et envois suspendus. Les conseillers répondent manuellement.",
    dot: "bg-danger",
    tone: "text-danger-soft-foreground",
    pulse: false,
  },
  auto: {
    short: "Automatique",
    text: "Les réponses de l’agent sont enregistrées sans validation.",
    dot: "bg-warning",
    tone: "text-warning-soft-foreground",
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

/** Pastille de l'état de l'agent (point coloré, qui pulse quand l'agent travaille). */
export function AgentDot({ mode, className = "" }: { mode: AgentMode; className?: string }) {
  const copy = AGENT_COPY[mode];
  return (
    <span className={`relative inline-flex size-2 shrink-0 ${className}`} aria-hidden="true">
      {copy.pulse && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${copy.dot}`} />}
      <span className={`relative inline-flex size-2 rounded-full ${copy.dot}`} />
    </span>
  );
}

/**
 * État et contrôle de l'agent pour le menu du compte : `row` (état lisible, action d'arrêt ou de reprise) va dans
 * le menu, `dialog` (confirmation HeroUI) en dehors, car le menu se ferme quand la confirmation s'ouvre
 * (`onAsk`). Le résultat est confirmé par un Toast ; l'observateur voit l'état sans action.
 */
export function useAgentControl({ refreshKey, readOnly, onAsk }: { refreshKey: string; readOnly: boolean; onAsk: () => void }) {
  const { data, reload } = useApi<{ mode: AgentMode }>(`/agent/mode?k=${encodeURIComponent(refreshKey)}`);
  const [confirm, setConfirm] = useState<AgentMode | null>(null);
  const [busy, setBusy] = useState(false);
  const mode = data?.mode ?? null;

  async function change(next: AgentMode) {
    setBusy(true);
    try {
      await api("/agent/mode", { method: "PUT", body: { mode: next } });
      toast.success(next === "manual" ? "Agent arrêté" : "Agent repris en mode assisté", {
        description: next === "manual" ? "Plus aucune réponse, relance ni envoi automatique." : "Ses brouillons attendent de nouveau votre validation.",
      });
      reload();
    } catch (err) {
      toast.danger("Changement de mode impossible", { description: err instanceof ApiError ? err.message : "Réessayez." });
    } finally {
      setBusy(false);
    }
  }

  const ask = (next: AgentMode) => {
    onAsk();
    setConfirm(next);
  };

  const row = mode && (
    <div className="flex flex-col gap-2 px-2 py-2" role="group" aria-label="Agent">
      <div className="flex items-start gap-3">
        <Bot className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm text-foreground">
            Agent
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${AGENT_COPY[mode].tone}`}>
              <AgentDot mode={mode} />
              {AGENT_COPY[mode].short}
            </span>
          </span>
          <span className="text-xs/[16px] text-muted">{AGENT_COPY[mode].text}</span>
        </div>
      </div>
      {!readOnly &&
        (mode !== "manual" ? (
          <Button size="sm" variant="danger-soft" fullWidth isDisabled={busy} onPress={() => ask("manual")}>
            <OctagonX className="size-4" aria-hidden="true" />
            Arrêt d’urgence
          </Button>
        ) : (
          <Button size="sm" variant="tertiary" fullWidth isDisabled={busy} onPress={() => ask("assisted")}>
            <Play className="size-4" aria-hidden="true" />
            Reprendre en mode assisté
          </Button>
        ))}
    </div>
  );

  const dialog = (
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
  );

  return { mode, row, dialog };
}
