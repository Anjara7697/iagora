"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
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
            produit. Les identifiants ne se saisissent jamais ici : ils restent
            dans le fichier <code>.env</code> du serveur.
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
          title="Messagerie IONOS"
          kind="Canal email"
          status={<Status tone={emailTone}>{emailLabel}</Status>}
          actions={
            <>
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
            </>
          }
        >
          {!s.configured && (
            <p className="warnbox" role="alert">
              Boîte non configurée : renseignez <code>EMAIL_USERNAME</code> et{" "}
              <code>EMAIL_PASSWORD</code> dans le <code>.env</code> du serveur.
            </p>
          )}
          <p>
            <Status tone={s.configured ? "ok" : "off"}>
              {s.configured ? "Identifiants présents" : "Identifiants absents"}
            </Status>{" "}
            <Status tone={s.enabled ? "ok" : "warn"}>
              {s.enabled ? "Réception active" : "Réception désactivée"}
            </Status>{" "}
            <Status tone={s.send_enabled ? "ok" : "warn"}>
              {s.send_enabled ? "Envoi activé" : "Envoi désactivé"}
            </Status>
          </p>
          <p>
            Réception : relève IMAP <code>{s.imap_host}</code> · dernière relève{" "}
            {formatDate(s.last_run_at)}
          </p>
          <p>
            Envoi : SMTP <code>{s.smtp_host}</code> · boîte {s.sender ?? "-"}
          </p>
          <p className="muted">
            {s.sandbox_recipients.length > 0
              ? `Bac à sable : l’agent n’écrit qu’à ${s.sandbox_recipients.join(", ")}.`
              : "Aucun bac à sable : tout destinataire est autorisé si l’envoi est activé."}{" "}
            Réception et envoi des messages, fil de conversation, détection de
            désinscription. Sans webhook : les nouveaux messages arrivent à
            chaque relève.
          </p>
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
        </Card>
      )}

      <Card
        region="Agenda"
        title="Agenda des conseillers"
        kind="Agenda"
        status={SOON}
      >
        <p>
          Non connecté : l’agent ne peut pas encore proposer ni réserver de
          créneaux.
        </p>
        <p className="muted">
          Servira à proposer uniquement des créneaux réellement libres
          (fournisseur à confirmer : Google Calendar, Outlook ou agenda IONOS).
        </p>
      </Card>
      <Card region="Zoom" title="Zoom" kind="Visioconférence" status={SOON}>
        <p>Non connecté : aucun lien de visioconférence n’est créé.</p>
        <p className="muted">
          Créera le lien de visioconférence de chaque rendez-vous.
        </p>
      </Card>
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
      <Card
        region="Formulaire"
        title="Formulaire du site et import CSV"
        kind="Source de leads"
        status={SOON}
      >
        <p>
          L’API de réception des leads existe déjà (<code>POST /prospects</code>
          ), mais elle exige un compte utilisateur : un jeton de service pour le
          formulaire reste à ajouter. L’import CSV est prévu.
        </p>
      </Card>
    </>
  );
}
