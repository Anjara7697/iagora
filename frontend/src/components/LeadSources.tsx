"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { ServiceToken } from "@/lib/types";
import { CampaignSourcePicker } from "./CampaignSourcePicker";

/** Formulaire du site, n8n et autres outils : jetons de service, sans compte utilisateur. */
export function LeadSources() {
  const [tokens, setTokens] = useState<ServiceToken[]>([]);
  const [name, setName] = useState("");
  const [dest, setDest] = useState<{
    campaign_id: number | null;
    source_id: number | null;
  }>({ campaign_id: null, source_id: null });
  const [created, setCreated] = useState<ServiceToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<ServiceToken[]>("/integrations/tokens")
      .then(setTokens)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const t = await api<ServiceToken>("/integrations/tokens", {
        method: "POST",
        body: { name, ...dest },
      });
      setCreated(t);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: ServiceToken) {
    if (
      !window.confirm(
        `Révoquer « ${t.name} » ? Les envois avec ce jeton seront refusés immédiatement.`,
      )
    )
      return;
    try {
      await api(`/integrations/tokens/${t.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    }
  }

  const active = tokens.filter((t) => !t.revoked_at);
  return (
    <section className="card integ-card" aria-label="Formulaire et outils">
      <div className="integ-main">
        <div className="row">
          <h2>Formulaire du site et outils (n8n…)</h2>
          <span className={`badge integ-${active.length ? "ok" : "off"}`}>
            {active.length
              ? `${active.length} jeton(s) actif(s)`
              : "Aucun jeton"}
          </span>
        </div>
        <span className="eyebrow">Source de leads</span>
        <p className="muted">
          Un jeton permet à un formulaire ou un outil d’envoyer des prospects (
          <code>POST {API_URL}/leads</code>) sans compte utilisateur, vers la
          campagne choisie. Il ne donne accès à rien d’autre. Pour un fichier :{" "}
          <Link href="/prospects/import">importer un CSV</Link>.
        </p>
        {created?.token && (
          <div className="warnbox" role="status" aria-label="Nouveau jeton">
            <p>
              Jeton de <strong>{created.name}</strong> (affiché une seule fois)
              : <code>{created.token}</code>
            </p>
            <pre className="muted">{`curl -X POST ${API_URL}/leads \\
  -H "Authorization: Bearer ${created.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"first_name":"Inès","email":"ines@exemple.fr","message":"Je veux des infos","consent":true}'`}</pre>
            <button onClick={() => setCreated(null)}>
              J’ai copié le jeton
            </button>
          </div>
        )}
        <div className="form-row">
          <label>
            Nom du jeton
            <input
              value={name}
              placeholder="ex. Formulaire du site"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <CampaignSourcePicker value={dest} onChange={setDest} />
        </div>
        <div className="row">
          <button
            className="primary"
            onClick={create}
            disabled={busy || name.trim().length < 2}
          >
            Créer un jeton
          </button>
        </div>
        {tokens.length > 0 && (
          <ul className="plain" aria-label="Jetons de service">
            {tokens.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong> <code>{t.hint}</code> · créé le{" "}
                {formatDate(t.created_at)} · dernier envoi{" "}
                {formatDate(t.last_used_at)}{" "}
                {t.revoked_at ? (
                  <span className="badge warn">révoqué</span>
                ) : (
                  <button onClick={() => revoke(t)}>Révoquer</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
