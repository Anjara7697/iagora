"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { DELIVERY, formatDate, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { EmailCheck, EmailStatus } from "@/lib/types";

function Flag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={`badge ${on ? "" : "warn"}`}>{children}</span>;
}

export default function IntegrationsPage() {
  const user = useCurrentUser();
  const status = useApi<EmailStatus>(
    user?.role === "ADMIN" ? "/integrations/email" : null,
  );
  const [check, setCheck] = useState<EmailCheck | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user && user.role !== "ADMIN")
    return (
      <p className="card warnbox" role="alert">
        Cette page est réservée aux administrateurs.
      </p>
    );

  async function run(action: "check" | "sync") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === "check") {
        setCheck(
          await api<EmailCheck>("/integrations/email/check", {
            method: "POST",
          }),
        );
      } else {
        const r = await api<{ report: Record<string, number> }>(
          "/integrations/email/sync",
          { method: "POST" },
        );
        setNotice(
          `Passage terminé : ${r.report.received} reçu(s), ${r.report.sent} envoyé(s), ${r.report.blocked} bloqué(s), ${r.report.errors} erreur(s).`,
        );
        status.reload();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const s = status.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Intelligence · Intégrations</span>
          <h1>Intégrations</h1>
          <p className="muted">
            Canaux connectés à l&apos;agent. Les identifiants ne se saisissent
            jamais ici : ils restent dans le fichier <code>.env</code> du
            serveur.
          </p>
        </div>
      </div>
      <Loading loading={status.loading} error={status.error} onRetry={status.reload} />
      {s && (
        <section className="card" aria-label="Email">
          <h2>Email (IMAP / SMTP)</h2>
          {!s.configured && (
            <p className="warnbox" role="alert">
              Boîte non configurée : renseignez <code>EMAIL_USERNAME</code> et{" "}
              <code>EMAIL_PASSWORD</code> dans le <code>.env</code> du serveur.
            </p>
          )}
          <p>
            <Flag on={s.configured}>
              {s.configured ? "Identifiants présents" : "Identifiants absents"}
            </Flag>{" "}
            <Flag on={s.enabled}>
              {s.enabled ? "Réception active" : "Réception désactivée"}
            </Flag>{" "}
            <Flag on={s.send_enabled}>
              {s.send_enabled ? "Envoi activé" : "Envoi désactivé"}
            </Flag>
          </p>
          <dl className="kv">
            <dt>Adresse d&apos;envoi</dt>
            <dd>{s.sender ?? "-"}</dd>
            <dt>Serveurs</dt>
            <dd>
              IMAP <code>{s.imap_host}</code> · SMTP <code>{s.smtp_host}</code>
            </dd>
            <dt>Bac à sable</dt>
            <dd>
              {s.sandbox_recipients.length > 0
                ? `L’agent n’écrit qu’à : ${s.sandbox_recipients.join(", ")}`
                : "Aucun : tout destinataire est autorisé (si l’envoi est activé)"}
            </dd>
            <dt>Dernier passage</dt>
            <dd>{formatDate(s.last_run_at)}</dd>
          </dl>
          {s.last_error && (
            <p className="error" role="alert">
              Dernière erreur : {s.last_error}
            </p>
          )}
          <h3>Messages email par état</h3>
          {Object.keys(s.outbox).length === 0 ? (
            <p className="muted">Aucun message.</p>
          ) : (
            <ul className="plain">
              {Object.entries(s.outbox).map(([k, n]) => (
                <li key={k}>
                  {label(DELIVERY, k)} : <strong>{n}</strong>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button
              disabled={busy || !s.configured}
              onClick={() => run("check")}
            >
              Tester la connexion
            </button>
            <button
              disabled={busy || !s.configured}
              onClick={() => run("sync")}
            >
              Lancer un passage maintenant
            </button>
          </div>
          {check && (
            <ul className="plain" aria-label="Résultat du test">
              <li>
                IMAP : {check.imap === "ok" ? "✓ connecté" : `✗ ${check.imap}`}
              </li>
              <li>
                SMTP : {check.smtp === "ok" ? "✓ connecté" : `✗ ${check.smtp}`}
              </li>
            </ul>
          )}
          {notice && <p role="status">{notice}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </>
  );
}
