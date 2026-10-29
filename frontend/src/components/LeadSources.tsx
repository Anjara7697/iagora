"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { ServiceToken } from "@/lib/types";
import { CampaignSourcePicker } from "./CampaignSourcePicker";
import { Feedback, Field, SecretOnce } from "./forms";

/** Formulaire du site, n8n et autres outils : jetons de service, sans compte utilisateur. */
export function LeadSources({ embedded = false }: { embedded?: boolean }) {
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
    <section
      className={embedded ? undefined : "ui-card integ-card"}
      aria-label="Formulaire et outils"
    >
      <div className="integ-main settings-stack">
        {!embedded && (
          <>
            <div className="section-head">
              <h2>Formulaire du site et outils (n8n…)</h2>
              <span className={`ui-badge integ-${active.length ? "ok" : "off"}`}>
                {active.length
                  ? `${active.length} jeton(s) actif(s)`
                  : "Aucun jeton"}
              </span>
            </div>
            <span className="eyebrow">Source de leads</span>
          </>
        )}
        <p className="section-intro">
          Un jeton permet à un formulaire ou à un outil d’envoyer des prospects
          vers la campagne choisie, sans compte utilisateur. Il ne donne accès à
          rien d’autre. Pour un fichier :{" "}
          <Link href="/prospects/import">importer un CSV</Link>.
        </p>
        {created?.token && (
          <SecretOnce
            label="Nouveau jeton"
            intro={
              <>
                Jeton de <strong>{created.name}</strong> :
              </>
            }
            secret={created.token}
            doneLabel="J’ai copié le jeton"
            onDone={() => setCreated(null)}
          >
            <pre className="code-block">{`curl -X POST ${API_URL}/leads \\
  -H "Authorization: Bearer ${created.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"first_name":"Inès","email":"ines@exemple.fr","message":"Je veux des infos","consent":true}'`}</pre>
          </SecretOnce>
        )}
        <Field label="Nom du jeton" note="Ex. Formulaire du site, n8n.">
          <input
            value={name}
            placeholder="Formulaire du site"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="field-row">
          <span className="field-label">Destination</span>
          <div className="field-control">
            <div className="form-row">
              <CampaignSourcePicker value={dest} onChange={setDest} />
            </div>
            <p className="field-note">
              Les prospects reçus avec ce jeton y sont rangés automatiquement.
            </p>
          </div>
        </div>
        <div className="actions-bar">
          <button
            className="primary"
            onClick={create}
            disabled={busy || name.trim().length < 2}
          >
            Créer un jeton
          </button>
          <Feedback error={error} />
        </div>
        {tokens.length > 0 && (
          <div aria-label="Jetons de service" role="list">
            {tokens.map((t) => (
              <div className="item-row" role="listitem" key={t.id}>
                <span className="item-main">
                  <strong>{t.name}</strong>
                  <span className="item-meta">
                    <code>{t.hint}</code> · créé le {formatDate(t.created_at)} ·
                    dernier envoi {formatDate(t.last_used_at)}
                  </span>
                </span>
                <span className="item-actions">
                  {t.revoked_at ? (
                    <span className="ui-badge warn">Révoqué</span>
                  ) : (
                    <button onClick={() => revoke(t)}>Révoquer</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
