"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { CalendarSettings } from "@/components/CalendarSettings";
import { EmailSettings } from "@/components/EmailSettings";
import { Feedback, Stats } from "@/components/forms";
import { LeadSources } from "@/components/LeadSources";
import { ZoomSettings } from "@/components/ZoomSettings";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { DELIVERY, formatDate, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { EmailCheck, EmailStatus } from "@/lib/types";

type Tone = "ok" | "warn" | "off";

function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge integ-${tone}`}>{children}</span>;
}

function Card({
  title,
  status,
  kind,
  children,
  actions,
  region,
}: {
  title: string;
  status: React.ReactNode;
  kind: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  region: string;
}) {
  return (
    <section className="card integ-card" aria-label={region}>
      <div className="integ-main">
        <div className="row">
          <h2>{title}</h2>
          {status}
        </div>
        <span className="eyebrow">{kind}</span>
        {children}
      </div>
      {actions && <div className="integ-actions">{actions}</div>}
    </section>
  );
}

const SOON = <Status tone="off">À venir</Status>;

export default function IntegrationsPage() {
  const user = useCurrentUser();
  // keepPrevious : recharger l'état après un enregistrement ne démonte pas le formulaire.
  const status = useApi<EmailStatus>(
    user?.role === "ADMIN" ? "/integrations/email" : null,
    { keepPrevious: true },
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
    if (
      action === "sync" &&
      status.data?.send_enabled &&
      !window.confirm(
        "L’envoi est activé : ce passage peut envoyer de vrais emails aux prospects (hors bac à sable). Continuer ?",
      )
    )
      return;
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
          {
            method: "POST",
          },
        );
        const n = (key: string) => r.report[key] ?? 0;
        setNotice(
          `Passage terminé : ${n("received")} reçu(s), ${n("sent")} envoyé(s), ${n("blocked")} bloqué(s), ${n("errors")} erreur(s).`,
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
  const emailTone: Tone = !s?.configured
    ? "off"
    : s.last_error
      ? "warn"
      : s.enabled
        ? "ok"
        : "warn";
  const emailLabel = !s?.configured
    ? "Non configuré"
    : s.last_error
      ? "Erreur"
      : s.enabled
        ? "Connecté"
        : "Réception désactivée";
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration · Intégrations</span>
          <h1>Intégrations</h1>
          <p className="muted">
            Chaque intégration indique ce qu’elle alimente réellement dans le
            produit. Une intégration en erreur prive l’agent de leads ou de
            canal. Les identifiants saisis ici sont chiffrés sur le serveur et
            jamais réaffichés.
          </p>
        </div>
      </div>
      <Loading
        loading={status.loading}
        error={status.error}
        onRetry={status.reload}
      />

      {s && (
        <Card
          region="Email"
          title="Messagerie"
          kind="Canal email"
          status={<Status tone={emailTone}>{emailLabel}</Status>}
          actions={
            <>
              <button
                disabled={busy || !s.configured}
                onClick={() => run("check")}
              >
                Tester la boîte enregistrée
              </button>
              <button
                disabled={busy || !s.configured}
                onClick={() => run("sync")}
              >
                Lancer un passage maintenant
              </button>
            </>
          }
        >
          {!s.configured && (
            <p className="warnbox" role="alert">
              Boîte non configurée : renseignez-la ci-dessous (adresse et mot de
              passe, les serveurs sont détectés automatiquement).
            </p>
          )}
          <div className="row">
            <Status tone={s.configured ? "ok" : "off"}>
              {s.configured ? "Identifiants présents" : "Identifiants absents"}
            </Status>
            <Status tone={s.enabled ? "ok" : "warn"}>
              {s.enabled ? "Réception active" : "Réception désactivée"}
            </Status>
            <Status tone={s.send_enabled ? "ok" : "warn"}>
              {s.send_enabled ? "Envoi activé" : "Envoi désactivé"}
            </Status>
          </div>
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
          {s.last_error && (
            <p className="error" role="alert">
              Dernière erreur : {s.last_error}
            </p>
          )}
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
          <Feedback notice={notice} error={error} />
          <EmailSettings onSaved={status.reload} />
        </Card>
      )}

      <CalendarSettings />
      <ZoomSettings />
      <Card
        region="Meta Business"
        title="Meta Business (Messenger / Instagram)"
        kind="Canal messagerie"
        status={SOON}
      >
        <p>
          Aucun webhook actif : les messages privés ne sont pas relevés
          automatiquement.
        </p>
        <p className="muted">
          Dépend de la validation de l’application Meta ; la fenêtre de réponse
          est limitée à 24 h.
        </p>
      </Card>
      <Card
        region="LinkedIn"
        title="LinkedIn Lead Gen"
        kind="Source de leads"
        status={SOON}
      >
        <p>
          Aucune synchronisation : les leads LinkedIn passent par le formulaire
          externe.
        </p>
      </Card>
      <LeadSources />
    </>
  );
}
