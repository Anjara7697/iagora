"use client";

import { Tabs, toast } from "@heroui/react";
import { Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { EmailSettings } from "@/components/EmailSettings";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, ErrorText, Notice, TAB_RADIUS } from "@/components/ds/controls";
import { cx } from "@/components/ds/layout";
import { ActionsBar, InfoRow, StatePill, Stats } from "@/components/ds/settings";
import { api, failure } from "@/lib/api";
import { replaceUrl } from "@/lib/url";
import { DELIVERY, formatDate, label } from "@/lib/labels";
import type { EmailCheck, EmailStatus, Tone } from "@/lib/types";

type EmailTab = "overview" | "config";

/** Messagerie : « Vue d'ensemble » (état, actions sur la boîte enregistrée) puis « Configuration ».
 *  L'onglet ouvert est dans l'adresse (`?c=email&tab=config`, règle 3). */
export function EmailConnector({
  status: s,
  onReload,
  onDirtyChange,
}: {
  status: EmailStatus;
  onReload: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const requested = useSearchParams().get("tab");
  const tab: EmailTab = requested === "config" || requested === "overview" ? requested : s.configured ? "overview" : "config";
  const setTab = (next: EmailTab) => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    replaceUrl(`${window.location.pathname}?${params.toString()}`);
  };
  const [check, setCheck] = useState<EmailCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: "check" | "sync") {
    setBusy(true);
    setError(null);
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
        toast.success("Passage terminé", {
          description: `${n("received")} reçu(s), ${n("sent")} envoyé(s), ${n("blocked")} bloqué(s), ${n("errors")} erreur(s).`,
        });
        onReload();
      }
    } catch (err) {
      setError(failure(action === "check" ? "Test de la boîte impossible" : "Passage impossible", err));
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
    <div className="flex flex-col gap-4">
      {!s.configured && (
        <Notice tone="warning">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-[200px] flex-1">
              Boîte non configurée : renseignez l’adresse et le mot de passe, les serveurs sont détectés automatiquement.
            </span>
            {tab !== "config" && (
              <Btn size="sm" variant="outline" onClick={() => setTab("config")}>
                Configurer la boîte
              </Btn>
            )}
          </div>
        </Notice>
      )}
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as EmailTab)}>
        <Tabs.ListContainer className={TAB_RADIUS.container}>
          <Tabs.List aria-label="Messagerie">
            {(
              [
                ["overview", "Vue d’ensemble"],
                ["config", "Configuration"],
              ] as const
            ).map(([id, text]) => (
              <Tabs.Tab key={id} id={id} className={TAB_RADIUS.tab}>
                {text}
                <Tabs.Indicator className={TAB_RADIUS.indicator} />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="overview" className="pt-4" shouldForceMount hidden={tab !== "overview"}>
      <section aria-label="Messagerie" className="flex flex-col gap-4">
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
          {s.send_enabled ? (
            <ConfirmDialog
              trigger={
                <Btn variant="outline" disabled={busy || !s.configured}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Lancer un passage maintenant
                </Btn>
              }
              title="Lancer un passage maintenant ?"
              description="L’envoi est activé : ce passage peut envoyer de vrais emails aux prospects (hors bac à sable)."
              confirmLabel="Lancer le passage"
              status="warning"
              onConfirm={() => void run("sync")}
            />
          ) : (
            <Btn variant="outline" disabled={busy || !s.configured} onClick={() => run("sync")}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Lancer un passage maintenant
            </Btn>
          )}
        </ActionsBar>
        <p className="text-xs/[18px] text-muted">
          Ces actions utilisent la boîte enregistrée. Pour essayer des
          modifications avant de les appliquer, utilisez « Tester ces paramètres
          » dans l’onglet Configuration.
        </p>
        {error && <ErrorText>{error}</ErrorText>}
        {check &&
          (checkPassed ? (
            <Notice aria-label="Résultat du test">Boîte joignable : IMAP et SMTP connectés.</Notice>
          ) : (
            <ErrorText aria-label="Résultat du test">
              {`Boîte injoignable : IMAP ${check.imap === "ok" ? "connecté" : check.imap} · SMTP ${check.smtp === "ok" ? "connecté" : check.smtp}`}
            </ErrorText>
          ))}
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
        </Tabs.Panel>
        {/* Gardé monté : une saisie en cours n'est pas perdue en changeant d'onglet. */}
        <Tabs.Panel id="config" className="pt-4" shouldForceMount hidden={tab !== "config"}>
          <EmailSettings
            disabled={busy}
            onBusyChange={setBusy}
            onDirtyChange={onDirtyChange}
            onSaved={() => {
              setCheck(null);
              onReload();
            }}
          />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
