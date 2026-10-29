"use client";

import { Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { EmailSettings } from "@/components/EmailSettings";
import { Btn, ErrorText } from "@/components/ds/controls";
import { cx } from "@/components/ds/layout";
import { ActionsBar, Feedback, InfoRow, StatePill, Stats } from "@/components/ds/settings";
import { api, ApiError } from "@/lib/api";
import { DELIVERY, formatDate, label } from "@/lib/labels";
import type { EmailCheck, EmailStatus, Tone } from "@/lib/types";

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
    <div data-ui="v2" className="flex flex-col gap-4">
      {!s.configured && (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-[13px]/[20px] text-warning-soft-foreground" role="alert">
          Boîte non configurée : renseignez-la dans l’onglet « Configuration »
          (adresse et mot de passe, les serveurs sont détectés automatiquement).
        </p>
      )}
      <div className="inline-flex w-fit gap-0.5 rounded-xl bg-surface-tertiary p-[3px]" role="tablist" aria-label="Messagerie">
        {(
          [
            ["overview", "Vue d’ensemble"],
            ["config", "Configuration"],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`email-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`email-panel-${id}`}
            onClick={() => setTab(id)}
            className={cx(
              "inline-flex h-8 items-center rounded-[9px] px-3 text-[13px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus",
              tab === id ? "bg-segment text-foreground shadow-surface" : "text-muted hover:text-foreground",
            )}
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
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-secondary px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1 text-[13px] text-muted">Dernier test de la boîte</span>
            <StatePill tone={testTone}>{testLabel}</StatePill>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="État de la messagerie">
            {(
              [
                [s.configured, s.configured ? "Identifiants présents" : "Identifiants absents"],
                [s.enabled, s.enabled ? "Réception active" : "Réception désactivée"],
                [s.send_enabled, s.send_enabled ? "Envoi activé" : "Envoi désactivé"],
              ] as const
            ).map(([on, text]) => (
              <li key={text} className="flex items-center gap-2 text-[13px] text-foreground">
                <span className={cx("size-2 rounded-full", on ? "bg-success" : "bg-muted/40")} aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <ActionsBar>
          <Btn variant="outline" disabled={busy || !s.configured} onClick={() => run("check")}>
            <ShieldCheck className="size-4" aria-hidden="true" />
            Tester la boîte enregistrée
          </Btn>
          <Btn variant="outline" disabled={busy || !s.configured} onClick={() => run("sync")}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Lancer un passage maintenant
          </Btn>
        </ActionsBar>
        <p className="text-xs/[18px] text-muted">
          Ces actions utilisent la boîte enregistrée. Pour essayer des
          modifications avant de les appliquer, utilisez « Tester ces paramètres
          » dans l’onglet Configuration.
        </p>
        <Feedback notice={notice} error={error} />
        {check && (
          <ul className="flex flex-col gap-1 rounded-xl border border-separator px-4 py-3 font-mono text-[13px]" aria-label="Résultat du test">
            <li className={check.imap === "ok" ? "text-success" : "text-danger"}>
              IMAP : {check.imap === "ok" ? "✓ connecté" : `✗ ${check.imap}`}
            </li>
            <li className={check.smtp === "ok" ? "text-success" : "text-danger"}>
              SMTP : {check.smtp === "ok" ? "✓ connecté" : `✗ ${check.smtp}`}
            </li>
          </ul>
        )}
        {s.last_error && <ErrorText>Dernière erreur : {s.last_error}</ErrorText>}
        <InfoRow label="Réception">
          <span>
            Relève IMAP <code className="rounded bg-surface-tertiary px-1 font-mono text-[12.5px]">{s.imap_host}</code> · dernière relève{" "}
            {formatDate(s.last_run_at)}
          </span>
        </InfoRow>
        <InfoRow label="Envoi">
          <span className="inline-flex flex-wrap items-center gap-1">
            <Mail className="size-3.5 text-muted" aria-hidden="true" />
            SMTP <code className="rounded bg-surface-tertiary px-1 font-mono text-[12.5px]">{s.smtp_host}</code> · boîte {s.sender ?? "-"}
          </span>
        </InfoRow>
        <InfoRow
          label="Bac à sable"
          note="Réception et envoi, fil de conversation, détection de désinscription. Les nouveaux messages arrivent à chaque relève."
        >
          <span>
            {s.sandbox_recipients.length > 0
              ? `L’agent n’écrit qu’à ${s.sandbox_recipients.join(", ")}.`
              : "Aucun : tout destinataire est autorisé si l’envoi est activé."}
          </span>
        </InfoRow>
        <InfoRow label="Messages email par état">
          {Object.keys(s.outbox).length === 0 ? (
            <span className="text-muted">Aucun message.</span>
          ) : (
            <Stats
              label="Messages email par état"
              items={Object.entries(s.outbox).map(([k, n]) => ({
                value: n,
                caption: label(DELIVERY, k),
              }))}
            />
          )}
        </InfoRow>
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
