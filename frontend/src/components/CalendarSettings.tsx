"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { CalendarSettings as Settings, Page } from "@/lib/types";

const MODES: Record<Settings["provider"], string> = {
  none: "Aucun : les demandes de rendez-vous sont transférées au conseiller",
  demo: "Démonstration : créneaux fictifs (jamais en production)",
  google: "Google Agenda de chaque conseiller",
};

/** Agenda des conseillers, réglé par l'administrateur : aucune variable `.env`. */
export function CalendarSettings() {
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
      <section className="card integ-card" aria-label="Agenda">
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
  const tone =
    cfg.provider === "none" ? "off" : cfg.provider === "demo" ? "warn" : "ok";
  const badge =
    cfg.provider === "none"
      ? "Non branché"
      : cfg.provider === "demo"
        ? "Démonstration"
        : `${connected} agenda(s) connecté(s)`;

  return (
    <section className="card integ-card" aria-label="Agenda">
      <div className="integ-main">
        <div className="row">
          <h2>Agenda des conseillers</h2>
          <span className={`badge integ-${tone}`}>{badge}</span>
        </div>
        <span className="eyebrow">Agenda</span>
        <p className="muted">
          Sert à proposer uniquement des créneaux réellement libres et à
          réserver le rendez-vous dans l’agenda du conseiller.
          {cfg.source === "env" &&
            " Réglage actuel : fichier .env du serveur (enregistrer ici le remplace)."}
        </p>
        <div className="form-row">
          <label>
            Mode
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
          </label>
        </div>
        {cfg.provider === "google" && (
          <>
            <div className="form-row">
              <label>
                Identifiant client OAuth Google
                <input
                  value={cfg.google_client_id}
                  placeholder="….apps.googleusercontent.com"
                  onChange={(e) =>
                    setCfg({ ...cfg, google_client_id: e.target.value })
                  }
                />
              </label>
              <label>
                Code secret du client
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={cfg.client_secret_set ? "•••••• (inchangé)" : ""}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </label>
              <label>
                Agenda par défaut (prospect sans conseiller)
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
              </label>
            </div>
            <p className="muted">
              URI de redirection à déclarer dans l’application Google :{" "}
              <code>{cfg.redirect_uri}</code>
            </p>
            <h3>Agendas connectés</h3>
            {connected === 0 ? (
              <p className="muted">
                Aucun pour l’instant : chaque conseiller connecte le sien depuis
                « Mon compte ».
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
          </>
        )}
        <div className="row">
          <button className="primary" onClick={save} disabled={busy}>
            Enregistrer l’agenda
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
