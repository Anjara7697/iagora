"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { MyCalendar as Status } from "@/lib/types";

const RESULTS: Record<string, string> = {
  connected: "Agenda Google connecté.",
  refused: "Connexion annulée : l’accès à l’agenda n’a pas été autorisé.",
  error: "La connexion à Google a échoué.",
};

/** Section « Mon agenda » de Mon compte : connexion OAuth à son Google Agenda. */
export function MyCalendar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = () =>
    api<Status>("/calendar/me")
      .then(setStatus)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    // Retour de Google : ?calendar=connected|refused|error
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("calendar");
    if (outcome) {
      const detail = params.get("detail");
      setResult(
        `${RESULTS[outcome] ?? outcome}${detail && outcome !== "connected" ? ` (${detail})` : ""}`,
      );
      window.history.replaceState(null, "", window.location.pathname);
    }
    load();
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ url: string }>("/calendar/google/connect", {
        method: "POST",
        body: { return_to: `${window.location.origin}/account` },
      });
      window.location.assign(r.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Déconnecter votre agenda Google ?")) return;
    setBusy(true);
    setError(null);
    try {
      await api("/calendar/me", { method: "DELETE" });
      setResult("Agenda déconnecté.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section-card" aria-label="Mon agenda">
      <span className="section-label">Mon agenda</span>
      {result && (
        <p role="status" className="status-text status-ok">
          {result}
        </p>
      )}
      {status && !status.available && (
        <p className="muted">
          Google Agenda n’est pas encore branché par l’administrateur
          (Intégrations → Agenda).
        </p>
      )}
      {status?.available && status.connected && (
        <>
          <p>
            Connecté à{" "}
            <strong>{status.account_email ?? "Google Agenda"}</strong> depuis le{" "}
            {formatDate(status.connected_at)}. L’agent propose vos créneaux
            libres et réserve les rendez-vous dans cet agenda.
          </p>
          {status.last_error && (
            <p className="error" role="alert">
              L’autorisation a été révoquée : reconnectez votre agenda.
            </p>
          )}
          <div className="row">
            {status.last_error && (
              <button className="primary" onClick={connect} disabled={busy}>
                Reconnecter mon agenda Google
              </button>
            )}
            <button onClick={disconnect} disabled={busy}>
              Déconnecter
            </button>
          </div>
        </>
      )}
      {status?.available && !status.connected && (
        <>
          <p className="muted">
            Connectez votre Google Agenda pour que l’agent propose vos créneaux
            réellement libres et y réserve les rendez-vous.
          </p>
          <button className="primary" onClick={connect} disabled={busy}>
            Connecter mon agenda Google
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
