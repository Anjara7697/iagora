"use client";

import { Video } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, ErrorText, Notice, Tag } from "./ds/controls";
import { Eyebrow } from "./ds/layout";
import { ActionsBar } from "./ds/settings";
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

  const connectedTag =
    status?.mode === "advisor" ? (
      status.connected ? (
        status.last_error ? <Tag tone="danger">À reconnecter</Tag> : <Tag tone="success">Connecté</Tag>
      ) : (
        <Tag>Non connecté</Tag>
      )
    ) : null;

  return (
    <section className="card card--default gap-4 p-5" aria-label="Mon Zoom">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-foreground" aria-hidden="true">
          <Video className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <Eyebrow>Mon Zoom</Eyebrow>
          <h2 className="text-base font-semibold text-foreground">Visioconférence Zoom</h2>
        </div>
        {connectedTag}
      </div>
      {result && <Notice>{result}</Notice>}
      {status?.mode === "advisor" && status.connected && (
        <>
          <p className="text-[13px]/[20px] text-foreground">
            Connecté à <strong>{status.account_email ?? "Zoom"}</strong> depuis
            le {formatDate(status.connected_at)}. Les rendez-vous réservés par
            l’agent ont un lien Zoom à votre nom.
          </p>
          {status.last_error && (
            <p className="text-[13px] text-danger" role="alert">
              L’autorisation a été révoquée : reconnectez votre compte Zoom.
            </p>
          )}
          <ActionsBar>
            {status.last_error && (
              <Btn variant="primary" onClick={connect} disabled={busy}>
                Reconnecter mon compte Zoom
              </Btn>
            )}
            <Btn variant="outline" onClick={disconnect} disabled={busy}>
              Déconnecter
            </Btn>
          </ActionsBar>
        </>
      )}
      {status?.mode === "advisor" && !status.connected && (
        <>
          <p className="text-[13px]/[20px] text-muted">
            Connectez votre compte Zoom pour que vos rendez-vous aient un lien
            de visioconférence à votre nom.
          </p>
          <Btn variant="primary" onClick={connect} disabled={busy}>
            Connecter mon compte Zoom
          </Btn>
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  );
}
