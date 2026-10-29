"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, ErrorText, Notice, Tag } from "./ds/controls";
import { Eyebrow } from "./ds/layout";
import { ActionsBar } from "./ds/settings";
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

  const connectedTag = status?.available ? (
    status.connected ? (
      status.last_error ? <Tag tone="danger">À reconnecter</Tag> : <Tag tone="success">Connecté</Tag>
    ) : (
      <Tag>Non connecté</Tag>
    )
  ) : null;

  return (
    <section data-ui="v2" className="card card--default gap-4 p-5" aria-label="Mon agenda">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-foreground" aria-hidden="true">
          <CalendarDays className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <Eyebrow>Mon agenda</Eyebrow>
          <h2 className="text-base font-semibold text-foreground">Google Agenda</h2>
        </div>
        {connectedTag}
      </div>
      {result && <Notice>{result}</Notice>}
      {status && !status.available && (
        <p className="text-[13px]/[20px] text-muted">
          Google Agenda n’est pas encore branché par l’administrateur
          (Intégrations → Agenda).
        </p>
      )}
      {status?.available && status.connected && (
        <>
          <p className="text-[13px]/[20px] text-foreground">
            Connecté à{" "}
            <strong>{status.account_email ?? "Google Agenda"}</strong> depuis le{" "}
            {formatDate(status.connected_at)}. L’agent propose vos créneaux
            libres et réserve les rendez-vous dans cet agenda.
          </p>
          {status.last_error && (
            <p className="text-[13px] text-danger" role="alert">
              L’autorisation a été révoquée : reconnectez votre agenda.
            </p>
          )}
          <ActionsBar>
            {status.last_error && (
              <Btn variant="primary" onClick={connect} disabled={busy}>
                Reconnecter mon agenda Google
              </Btn>
            )}
            <Btn variant="outline" onClick={disconnect} disabled={busy}>
              Déconnecter
            </Btn>
          </ActionsBar>
        </>
      )}
      {status?.available && !status.connected && (
        <>
          <p className="text-[13px]/[20px] text-muted">
            Connectez votre Google Agenda pour que l’agent propose vos créneaux
            réellement libres et y réserve les rendez-vous.
          </p>
          <Btn variant="primary" onClick={connect} disabled={busy}>
            Connecter mon agenda Google
          </Btn>
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  );
}
