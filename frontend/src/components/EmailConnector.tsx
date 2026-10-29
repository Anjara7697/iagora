"use client";

import { useState } from "react";
import { EmailSettings } from "@/components/EmailSettings";
import { Feedback, Stats } from "@/components/forms";
import { api, ApiError } from "@/lib/api";
import { DELIVERY, formatDate, label } from "@/lib/labels";
import type { EmailCheck, EmailStatus, Tone } from "@/lib/types";

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge integ-${tone}`}>{children}</span>;
}

/** Messagerie : « Vue d'ensemble » (état, actions sur la boîte enregistrée) puis « Configuration ». */
export function EmailConnector({
  status: s,
  onReload,
}: {
  status: EmailStatus;
  onReload: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "config">(
    s.configured ? "overview" : "config",
  );
  const [check, setCheck] = useState<EmailCheck | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "check" | "sync") {
    if (
      action === "sync" &&
      s.send_enabled &&
      !window.confirm(
        "L’envoi est activé : ce passage peut envoyer de vrais emails aux prospects (hors bac à sable). Continuer ?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (action === "check") setCheck(null);
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
        const n = (key: string) => r.report[key] ?? 0;
        setNotice(
          `Passage terminé : ${n("received")} reçu(s), ${n("sent")} envoyé(s), ${n("blocked")} bloqué(s), ${n("errors")} erreur(s).`,
        );
        onReload();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const checkPassed = check?.imap === "ok" && check?.smtp === "ok";
  const testTone: Tone = !s.configured
    ? "off"
    : !s.last_error && checkPassed
      ? "ok"
      : "warn";
  const testLabel = !s.configured
    ? "Non configuré"
    : s.last_error
      ? "Erreur signalée"
      : check
        ? checkPassed
          ? "Test réussi"
          : "Test échoué"
        : "À tester";

  return (
    <div className="settings-stack">
      {!s.configured && (
        <p className="warnbox" role="alert">
          Boîte non configurée : renseignez-la dans l’onglet « Configuration »
          (adresse et mot de passe, les serveurs sont détectés automatiquement).
        </p>
      )}
      <div className="segmented" role="tablist" aria-label="Messagerie">
        {(
          [
            ["overview", "Vue d’ensemble"],
            ["config", "Configuration"],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            role="tab"
            id={`email-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`email-panel-${id}`}
            onClick={() => setTab(id)}
          >
            {text}
          </button>
        ))}
      </div>

      <section
        id="email-panel-overview"
        role="tabpanel"
        aria-labelledby="email-tab-overview"
        aria-label="Messagerie"
        hidden={tab !== "overview"}
        className="settings-stack"
      >
        <div className="connector-state">
          <span className="muted">Dernier test de la boîte</span>
          <Pill tone={testTone}>{testLabel}</Pill>
        </div>
        <ul className="connector-facts" aria-label="État de la messagerie">
          {(
            [
              [
                s.configured,
                s.configured ? "Identifiants présents" : "Identifiants absents",
              ],
              [
                s.enabled,
                s.enabled ? "Réception active" : "Réception désactivée",
              ],
              [
                s.send_enabled,
                s.send_enabled ? "Envoi activé" : "Envoi désactivé",
              ],
            ] as const
          ).map(([on, text]) => (
            <li key={text}>
              <span className={`dot ${on ? "on" : "off"}`} aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
        <div className="actions-bar">
          <button disabled={busy || !s.configured} onClick={() => run("check")}>
            Tester la boîte enregistrée
          </button>
          <button disabled={busy || !s.configured} onClick={() => run("sync")}>
            Lancer un passage maintenant
          </button>
        </div>
        <p className="section-intro integration-saved-note">
          Ces actions utilisent la boîte enregistrée. Pour essayer des
          modifications avant de les appliquer, utilisez « Tester ces paramètres
          » dans l’onglet Configuration.
        </p>
        <Feedback notice={notice} error={error} />
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
        {s.last_error && (
          <p className="error" role="alert">
            Dernière erreur : {s.last_error}
          </p>
        )}
        <div className="field-row">
          <span className="field-label">Réception</span>
          <span className="field-control">
            <span>
              Relève IMAP <code>{s.imap_host}</code> · dernière relève{" "}
              {formatDate(s.last_run_at)}
            </span>
          </span>
        </div>
        <div className="field-row">
          <span className="field-label">Envoi</span>
          <span className="field-control">
            <span>
              SMTP <code>{s.smtp_host}</code> · boîte {s.sender ?? "-"}
            </span>
          </span>
        </div>
        <div className="field-row">
          <span className="field-label">Bac à sable</span>
          <span className="field-control">
            <span>
              {s.sandbox_recipients.length > 0
                ? `L’agent n’écrit qu’à ${s.sandbox_recipients.join(", ")}.`
                : "Aucun : tout destinataire est autorisé si l’envoi est activé."}
            </span>
            <span className="field-note">
              Réception et envoi, fil de conversation, détection de
              désinscription. Les nouveaux messages arrivent à chaque relève.
            </span>
          </span>
        </div>
        <div className="field-row">
          <span className="field-label">Messages email par état</span>
          <span className="field-control">
            {Object.keys(s.outbox).length === 0 ? (
              <span className="status-text">Aucun message.</span>
            ) : (
              <Stats
                label="Messages email par état"
                items={Object.entries(s.outbox).map(([k, n]) => ({
                  value: n,
                  caption: label(DELIVERY, k),
                }))}
              />
            )}
          </span>
        </div>
      </section>

      <div
        id="email-panel-config"
        role="tabpanel"
        aria-labelledby="email-tab-config"
        hidden={tab !== "config"}
      >
        <EmailSettings
          disabled={busy}
          onBusyChange={setBusy}
          onSaved={() => {
            setCheck(null);
            onReload();
          }}
        />
      </div>
    </div>
  );
}
