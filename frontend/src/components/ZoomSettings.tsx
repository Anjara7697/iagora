"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { ZoomMode, ZoomSettings as Settings } from "@/lib/types";

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
      <div className="integ-main">
        <div className="row">
          <h2>Zoom</h2>
          <span className={`badge integ-${tone}`}>{badge}</span>
        </div>
        <span className="eyebrow">Visioconférence</span>
        <p className="muted">
          Crée le lien de visioconférence de chaque rendez-vous réservé par
          l’agent.
          {cfg.source === "env" &&
            " Réglage actuel : fichier .env du serveur (enregistrer ici le remplace)."}
        </p>
        <div className="form-row">
          <label>
            Mode
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
          </label>
        </div>
        {cfg.mode !== "none" && (
          <div className="form-row">
            {cfg.mode === "account" && (
              <label>
                Account ID
                <input
                  value={cfg.account_id}
                  onChange={(e) =>
                    setCfg({ ...cfg, account_id: e.target.value })
                  }
                />
              </label>
            )}
            <label>
              Client ID
              <input
                value={cfg.client_id}
                onChange={(e) => setCfg({ ...cfg, client_id: e.target.value })}
              />
            </label>
            <label>
              Client secret
              <input
                type="password"
                autoComplete="new-password"
                placeholder={cfg.client_secret_set ? "•••••• (inchangé)" : ""}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </label>
            {cfg.mode === "account" && (
              <label>
                Hôte par défaut (email Zoom, ou « me »)
                <input
                  value={cfg.host_user}
                  onChange={(e) =>
                    setCfg({ ...cfg, host_user: e.target.value })
                  }
                />
              </label>
            )}
          </div>
        )}
        {cfg.mode === "account" && (
          <p className="muted">
            La réunion est créée au nom du conseiller s’il a un compte Zoom dans
            l’école, sinon au nom de l’hôte par défaut.
          </p>
        )}
        {cfg.mode === "advisor" && (
          <>
            <p className="muted">
              URL de redirection à déclarer dans l’application Zoom :{" "}
              <code>{cfg.redirect_uri}</code>
            </p>
            <h3>Comptes Zoom connectés</h3>
            {cfg.connections.length === 0 ? (
              <p className="muted">
                Aucun : chaque conseiller connecte le sien depuis « Mon compte
                ». Sans compte connecté, le rendez-vous est réservé sans lien.
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
          </>
        )}
        <div className="row">
          <button className="primary" onClick={save} disabled={busy}>
            Enregistrer Zoom
          </button>
        </div>
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
