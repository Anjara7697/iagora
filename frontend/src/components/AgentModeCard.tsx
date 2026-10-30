"use client";

import { Button } from "@heroui/react";
import { OctagonX, Play } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { AgentMode } from "@/lib/types";

const COPY: Record<AgentMode, { title: string; text: string; dot: string; pulse: boolean }> = {
  assisted: {
    title: "Agent — Validation requise",
    text: "L'agent prépare des brouillons ; rien n'est validé sans vous.",
    dot: "bg-success",
    pulse: true,
  },
  manual: {
    title: "Agent — Arrêt d'urgence",
    text: "Réponses, relances et envois de l’agent suspendus, même déjà validés. Les conseillers peuvent répondre manuellement.",
    dot: "bg-danger",
    pulse: false,
  },
  auto: {
    title: "Agent — Mode automatique",
    text: "Les réponses de l'agent sont enregistrées sans validation.",
    dot: "bg-warning",
    pulse: true,
  },
};

/** État de l'agent, toujours visible en bas du menu, avec l'arrêt d'urgence à portée de clic. */
export default function AgentModeCard({
  readOnly,
  refreshKey,
}: {
  readOnly: boolean;
  refreshKey: string;
}) {
  const { data, reload } = useApi<{ mode: AgentMode }>(
    `/agent/mode?k=${encodeURIComponent(refreshKey)}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const { mode } = data;
  const copy = COPY[mode];

  async function change(next: AgentMode) {
    setBusy(true);
    setError(null);
    try {
      await api("/agent/mode", { method: "PUT", body: { mode: next } });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-secondary p-3">
      <div className="flex items-start gap-2">
        <span className="relative mt-1.5 inline-flex size-2 shrink-0" aria-hidden="true">
          {copy.pulse && (
            <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${copy.dot}`} />
          )}
          <span className={`relative inline-flex size-2 rounded-full ${copy.dot}`} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <strong className="text-sm font-medium text-foreground">{copy.title}</strong>
          <p className="text-xs/[16px] text-muted">{copy.text}</p>
        </div>
      </div>
      {!readOnly &&
        (mode !== "manual" ? (
          <Button
            size="sm"
            variant="danger-soft"
            fullWidth
            isDisabled={busy}
            aria-label="Arrêt d'urgence : passer l’agent en mode Manuel, plus aucune réponse, relance ni envoi"
            onPress={() => {
              if (
                window.confirm(
                  "Arrêt d’urgence : suspendre les réponses, les relances et les envois de l’agent, y compris les messages déjà validés ? Les conseillers pourront toujours répondre manuellement. Un email déjà en cours de transmission ne peut pas être rappelé.",
                )
              )
                void change("manual");
            }}
          >
            <OctagonX className="size-4" aria-hidden="true" />
            Arrêt d&apos;urgence
          </Button>
        ) : (
          <Button
            size="sm"
            variant="tertiary"
            fullWidth
            isDisabled={busy}
            onPress={() => {
              if (
                window.confirm(
                  "Reprendre en mode assisté ? Les messages déjà validés pourront être envoyés si l’envoi est activé. Les anciens messages automatiques sans validation seront soumis à votre approbation.",
                )
              )
                void change("assisted");
            }}
          >
            <Play className="size-4" aria-hidden="true" />
            Reprendre en mode assisté
          </Button>
        ))}
      {error && (
        <p className="text-xs text-danger-soft-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
