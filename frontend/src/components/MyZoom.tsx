"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { MyZoom as Status } from "@/lib/types";

const RESULTS: Record<string, string> = {
  connected: "Compte Zoom connecté.",
  refused: "Connexion annulée : l’accès à Zoom n’a pas été autorisé.",
  error: "La connexion à Zoom a échoué.",
};

/** Section « Mon Zoom » de Mon compte (mode « compte de chaque conseiller »). */
export function MyZoom() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = () =>
    api<Status>("/zoom/me")
      .then(setStatus)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("zoom");
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
      const r = await api<{ url: string }>("/zoom/connect", {
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
    if (!window.confirm("Déconnecter votre compte Zoom ?")) return;
    setBusy(true);
    try {
      await api("/zoom/me", { method: "DELETE" });
      setResult("Compte Zoom déconnecté.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  if (status && status.mode !== "advisor" && !result) return null;

  return (
    <section className="card" aria-label="Mon Zoom">
      <h2>Mon Zoom</h2>
      {result && <p role="status">{result}</p>}
      {status?.mode === "advisor" && status.connected && (
        <>
          <p>
            Connecté à <strong>{status.account_email ?? "Zoom"}</strong> depuis
            le {formatDate(status.connected_at)}. Les rendez-vous réservés par
            l’agent ont un lien Zoom à votre nom.
          </p>
          {status.last_error && (
            <p className="error" role="alert">
              L’autorisation a été révoquée : reconnectez votre compte Zoom.
            </p>
          )}
          <div className="row">
            {status.last_error && (
              <button className="primary" onClick={connect} disabled={busy}>
                Reconnecter mon compte Zoom
              </button>
            )}
            <button onClick={disconnect} disabled={busy}>
              Déconnecter
            </button>
          </div>
        </>
      )}
      {status?.mode === "advisor" && !status.connected && (
        <>
          <p className="muted">
            Connectez votre compte Zoom pour que vos rendez-vous aient un lien
            de visioconférence à votre nom.
          </p>
          <button className="primary" onClick={connect} disabled={busy}>
            Connecter mon compte Zoom
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
