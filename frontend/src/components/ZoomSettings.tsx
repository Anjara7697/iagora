"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { ZoomMode, ZoomSettings as Settings } from "@/lib/types";
import { Feedback, Field } from "./forms";

const MODES: Record<ZoomMode, string> = {
  none: "Aucun : rendez-vous sans lien de visioconférence",
  account: "Compte Zoom de l’école (application Server-to-Server)",
  advisor: "Compte Zoom de chaque conseiller (connexion dans Mon compte)",
};

/** Visioconférence Zoom, réglée par l'administrateur : aucune variable `.env`. */
export function ZoomSettings() {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api<Settings>("/integrations/zoom")
      .then(setCfg)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    load();
  }, []);

  if (!cfg)
    return (
      <section className="card integ-card" aria-label="Zoom">
        {error ? <p className="error">{error}</p> : "Chargement…"}
      </section>
    );

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/integrations/zoom", {
        method: "PUT",
        body: {
          mode: cfg.mode,
          account_id: cfg.account_id,
          client_id: cfg.client_id,
          client_secret: secret || null,
          host_user: cfg.host_user || "me",
        },
      });
      setSecret("");
      setNotice("Zoom enregistré : pris en compte au prochain rendez-vous.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const tone = cfg.mode === "none" ? "off" : "ok";
  const badge =
    cfg.mode === "none"
      ? "Non branché"
      : cfg.mode === "account"
        ? "Compte de l’école"
        : `${cfg.connections.length} compte(s) connecté(s)`;

  return (
    <section className="card integ-card" aria-label="Zoom">
      <div className="integ-main settings-stack">
        <div className="section-head">
          <h2>Zoom</h2>
          <span className={`badge integ-${tone}`}>{badge}</span>
        </div>
        <span className="eyebrow">Visioconférence</span>
        <p className="section-intro">
          Crée le lien de visioconférence de chaque rendez-vous réservé par
          l’agent.
          {cfg.source === "env" &&
            " Réglage actuel : fichier .env du serveur (enregistrer ici le remplace)."}
        </p>
        <Field label="Mode">
          <select
            value={cfg.mode}
            onChange={(e) =>
              setCfg({ ...cfg, mode: e.target.value as ZoomMode })
            }
          >
            {(Object.keys(MODES) as ZoomMode[]).map((m) => (
              <option key={m} value={m}>
                {MODES[m]}
              </option>
            ))}
          </select>
        </Field>
        {cfg.mode === "account" && (
          <Field
            label="Account ID"
            note="Application « Server-to-Server OAuth » sur marketplace.zoom.us."
          >
            <input
              value={cfg.account_id}
              onChange={(e) => setCfg({ ...cfg, account_id: e.target.value })}
            />
          </Field>
        )}
        {cfg.mode !== "none" && (
          <>
            <Field label="Client ID">
              <input
                value={cfg.client_id}
                onChange={(e) => setCfg({ ...cfg, client_id: e.target.value })}
              />
            </Field>
            <Field
              label="Client secret"
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
          </>
        )}
        {cfg.mode === "account" && (
          <Field
            label="Hôte par défaut (email Zoom, ou « me »)"
            note="La réunion est créée au nom du conseiller s’il a un compte Zoom dans l’école, sinon au nom de cet hôte."
          >
            <input
              value={cfg.host_user}
              onChange={(e) => setCfg({ ...cfg, host_user: e.target.value })}
            />
          </Field>
        )}
        {cfg.mode === "advisor" && (
          <>
            <div className="field-row">
              <span className="field-label">URL de redirection</span>
              <div className="field-control">
                <code className="code-block">{cfg.redirect_uri}</code>
                <p className="field-note">
                  À déclarer dans l’application Zoom (HTTPS conseillé).
                </p>
              </div>
            </div>
            <div className="field-row">
              <span className="field-label">Comptes connectés</span>
              <div className="field-control">
                {cfg.connections.length === 0 ? (
                  <p className="field-note">
                    Aucun : chaque conseiller connecte le sien depuis « Mon
                    compte ». Sans compte connecté, le rendez-vous est réservé
                    sans lien.
                  </p>
                ) : (
                  <ul className="plain" aria-label="Comptes Zoom connectés">
                    {cfg.connections.map((c) => (
                      <li key={c.user_id}>
                        <strong>{c.username ?? `#${c.user_id}`}</strong> —{" "}
                        {c.account_email ?? "compte Zoom"} · connecté le{" "}
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
            Enregistrer Zoom
          </button>
          <Feedback notice={notice} error={error} />
        </div>
      </div>
    </section>
  );
}
