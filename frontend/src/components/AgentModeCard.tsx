"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { AgentMode } from "@/lib/types";

const COPY: Record<AgentMode, { title: string; text: string }> = {
  assisted: {
    title: "Agent — Mode assisté",
    text: "L'agent prépare des brouillons ; rien n'est validé sans vous.",
  },
  manual: {
    title: "Agent — Arrêt d'urgence",
    text: "L'agent ne traite plus aucun message. Les conseillers répondent.",
  },
  auto: {
    title: "Agent — Mode automatique",
    text: "Les réponses de l'agent sont enregistrées sans validation.",
  },
};

/** Mode de fonctionnement de l'agent et arrêt d'urgence (menu latéral). */
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
    <div className={`agent-mode agent-mode-${mode}`}>
      <strong>{copy.title}</strong>
      <p>{copy.text}</p>
      {!readOnly &&
        (mode === "assisted" ? (
          <button
            className="danger"
            disabled={busy}
            onClick={() => change("manual")}
          >
            Arrêt d&apos;urgence — passer en Manuel
          </button>
        ) : (
          <button disabled={busy} onClick={() => change("assisted")}>
            Reprendre en mode assisté
          </button>
        ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
