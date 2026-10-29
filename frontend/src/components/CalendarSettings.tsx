"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import { calendarBadge } from "@/lib/connectors";
import type { CalendarSettings as Settings, Page } from "@/lib/types";
import { Feedback, Field } from "./forms";

const MODES: Record<Settings["provider"], string> = {
  none: "Aucun : les demandes de rendez-vous sont transférées au conseiller",
  demo: "Démonstration : créneaux fictifs (jamais en production)",
  google: "Google Agenda de chaque conseiller",
};

/** Agenda des conseillers, réglé par l'administrateur : aucune variable `.env`.
 *  `embedded` : affiché dans un panneau qui porte déjà le titre et l'état. */
export function CalendarSettings({ embedded = false }: { embedded?: boolean }) {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [secret, setSecret] = useState("");
  const [advisors, setAdvisors] = useState<{ id: number; username: string }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api<Settings>("/integrations/calendar")
      .then(setCfg)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    load();
    api<Page<{ id: number; username: string }>>("/advisors?limit=200")
      .then((p) => setAdvisors(p.items))
      .catch(() => setAdvisors([]));
  }, []);

  if (!cfg)
    return (
      <section className="ui-card integ-card" aria-label="Agenda">
        {error ? <p className="error">{error}</p> : "Chargement…"}
      </section>
    );

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/integrations/calendar", {
        method: "PUT",
        body: {
          provider: cfg.provider,
          google_client_id: cfg.google_client_id,
          google_client_secret: secret || null,
          default_user_id: cfg.default_user_id,
        },
      });
      setSecret("");
      setNotice("Agenda enregistré : pris en compte immédiatement.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const connected = cfg.connections.length;
  const { tone, label: badge } = calendarBadge(cfg);

  return (
    <section
      className={embedded ? undefined : "ui-card integ-card"}
      aria-label="Agenda"
    >
      <div className="integ-main settings-stack">
        {!embedded && (
          <>
            <div className="section-head">
              <h2>Agenda des conseillers</h2>
              <span className={`ui-badge integ-${tone}`}>{badge}</span>
            </div>
            <span className="eyebrow">Agenda</span>
          </>
        )}
        <p className="section-intro">
          Sert à proposer uniquement des créneaux réellement libres et à
          réserver le rendez-vous dans l’agenda du conseiller.
          {cfg.source === "env" &&
            " Réglage actuel : fichier .env du serveur (enregistrer ici le remplace)."}
        </p>
        <Field label="Mode">
          <select
            value={cfg.provider}
            onChange={(e) =>
              setCfg({
                ...cfg,
                provider: e.target.value as Settings["provider"],
              })
            }
          >
            {(Object.keys(MODES) as Settings["provider"][]).map((m) => (
              <option key={m} value={m}>
                {MODES[m]}
              </option>
            ))}
          </select>
        </Field>
        {cfg.provider === "google" && (
          <>
            <Field
              label="Identifiant client OAuth Google"
              note="Google Cloud → Identifiants → ID client OAuth (application Web)."
            >
              <input
                value={cfg.google_client_id}
                placeholder="….apps.googleusercontent.com"
                onChange={(e) =>
                  setCfg({ ...cfg, google_client_id: e.target.value })
                }
              />
            </Field>
            <Field
              label="Code secret du client"
              note="Chiffré, jamais réaffiché. Vide : conserver le secret actuel."
            >
              <input
                type="password"
                autoComplete="new-password"
                placeholder={cfg.client_secret_set ? "•••••• (inchangé)" : ""}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
            <Field
              label="Agenda par défaut (prospect sans conseiller)"
              note="Sinon, la demande de rendez-vous est transférée au conseiller."
            >
              <select
                value={cfg.default_user_id ?? ""}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    default_user_id: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              >
                <option value="">Aucun : transfert au conseiller</option>
                {advisors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.username}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field-row">
              <span className="field-label">URI de redirection</span>
              <div className="field-control">
                <code className="code-block">{cfg.redirect_uri}</code>
                <p className="field-note">
                  À déclarer telle quelle dans l’application OAuth Google.
                </p>
              </div>
            </div>
            <div className="field-row">
              <span className="field-label">Agendas connectés</span>
              <div className="field-control">
                {connected === 0 ? (
                  <p className="field-note">
                    Aucun pour l’instant : chaque conseiller connecte le sien
                    depuis « Mon compte ».
                  </p>
                ) : (
                  <ul className="plain" aria-label="Agendas connectés">
                    {cfg.connections.map((c) => (
                      <li key={c.user_id}>
                        <strong>{c.username ?? `#${c.user_id}`}</strong> —{" "}
                        {c.account_email ?? "compte Google"} · connecté le{" "}
                        {formatDate(c.connected_at)}
                        {c.last_error && (
                          <span className="error"> · à reconnecter</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
        <div className="actions-bar">
          <button className="primary" onClick={save} disabled={busy}>
            Enregistrer l’agenda
          </button>
          <Feedback notice={notice} error={error} />
        </div>
      </div>
    </section>
  );
}
