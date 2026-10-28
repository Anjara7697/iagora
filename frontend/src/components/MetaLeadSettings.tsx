"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { MetaFormMapping, MetaSettings } from "@/lib/types";
import { CampaignSourcePicker } from "./CampaignSourcePicker";
import { Feedback, Field, Stats } from "./forms";

type Secrets = {
  app_secret: string;
  page_access_token: string;
  verify_token: string;
};

const EMPTY_SECRETS: Secrets = {
  app_secret: "",
  page_access_token: "",
  verify_token: "",
};

export function MetaLeadSettings() {
  const [cfg, setCfg] = useState<MetaSettings | null>(null);
  const [secrets, setSecrets] = useState<Secrets>(EMPTY_SECRETS);
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [destination, setDestination] = useState({
    campaign_id: null as number | null,
    source_id: null as number | null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [simulatedId, setSimulatedId] = useState<number | null>(null);

  const load = () =>
    api<MetaSettings>("/integrations/meta")
      .then(setCfg)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    load();
  }, []);

  if (!cfg)
    return (
      <section className="card integ-card" aria-label="Meta Lead Ads">
        {error ? <p className="error">{error}</p> : "Chargement…"}
      </section>
    );

  function addMapping() {
    const current = cfg;
    if (!current || !destination.campaign_id || !destination.source_id) return;
    const mapping: MetaFormMapping = {
      form_id: formId.trim(),
      form_name: formName.trim(),
      campaign_id: destination.campaign_id,
      source_id: destination.source_id,
      target_code: null,
      enabled: true,
    };
    setCfg({
      ...current,
      mappings: [
        ...current.mappings.filter((item) => item.form_id !== mapping.form_id),
        mapping,
      ],
    });
    setFormId("");
    setFormName("");
  }

  async function save() {
    const current = cfg;
    if (!current) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/integrations/meta", {
        method: "PUT",
        body: {
          app_id: current.app_id,
          api_version: current.api_version,
          enabled: current.enabled,
          mappings: current.mappings,
          app_secret: secrets.app_secret || null,
          page_access_token: secrets.page_access_token || null,
          verify_token: secrets.verify_token || null,
        },
      });
      setSecrets(EMPTY_SECRETS);
      setNotice("Configuration Meta enregistrée.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    const mapping = cfg?.mappings.find((item) => item.enabled);
    if (!mapping) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setSimulatedId(null);
    try {
      const result = await api<{
        prospect_id: number;
        created: boolean;
        duplicate: boolean;
      }>("/integrations/meta/simulate", {
        method: "POST",
        body: {
          form_id: mapping.form_id,
          first_name: "Prospect",
          last_name: "Meta Test",
          email: `meta-${Date.now()}@demo.example.com`,
          message: "Je souhaite recevoir des informations sur la formation.",
        },
      });
      setSimulatedId(result.prospect_id);
      setNotice("Lead fictif reçu et rattaché à la campagne.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const tone = cfg.last_success_at ? "ok" : cfg.configured ? "warn" : "off";
  const status = cfg.last_success_at
    ? "Testé avec un lead réel"
    : cfg.enabled && cfg.configured
      ? "Actif, à tester"
    : cfg.configured
      ? "Configuré, inactif"
      : "Non configuré";
  const webhookUrl = `${API_URL.replace(/\/$/, "")}/webhooks/meta`;

  return (
    <section className="card integ-card" aria-label="Meta Lead Ads">
      <div className="integ-main settings-stack">
        <div className="section-head">
          <h2>Meta Lead Ads</h2>
          <span className={`badge integ-${tone}`}>{status}</span>
        </div>
        <span className="eyebrow">Source de leads · Facebook et Instagram</span>
        <p className="section-intro">
          Reçoit les formulaires instantanés Meta, évite les doublons et range
          chaque prospect dans la campagne choisie. Les secrets sont chiffrés et
          ne sont jamais réaffichés.
        </p>
        <Field label="Identifiant de l’application Meta">
          <input
            value={cfg.app_id}
            placeholder="1234567890"
            onChange={(event) => setCfg({ ...cfg, app_id: event.target.value })}
          />
        </Field>
        <Field label="Version de l’API Graph" note="À conserver alignée avec l’application Meta.">
          <input
            value={cfg.api_version}
            placeholder="v24.0"
            onChange={(event) => setCfg({ ...cfg, api_version: event.target.value })}
          />
        </Field>
        {(
          [
            ["app_secret", "Code secret de l’application", cfg.app_secret_set],
            ["page_access_token", "Jeton d’accès de la page", cfg.page_access_token_set],
            ["verify_token", "Jeton de vérification du webhook", cfg.verify_token_set],
          ] as const
        ).map(([key, label, present]) => (
          <Field
            key={key}
            label={label}
            note="Vide : conserver la valeur enregistrée."
          >
            <input
              type="password"
              autoComplete="new-password"
              value={secrets[key]}
              placeholder={present ? "•••••• (inchangé)" : ""}
              onChange={(event) =>
                setSecrets({ ...secrets, [key]: event.target.value })
              }
            />
          </Field>
        ))}
        <div className="field-row">
          <span className="field-label">URL du webhook</span>
          <div className="field-control">
            <code className="code-block">{webhookUrl}</code>
            <p className="field-note">
              À copier dans Meta for Developers, avec le jeton de vérification
              choisi ci-dessus.
            </p>
          </div>
        </div>

        <div className="settings-subsection">
          <h3>Correspondance des formulaires</h3>
          <p className="field-note">
            Un identifiant de formulaire Meta correspond à une seule source de
            campagne IAGORA.
          </p>
          {cfg.mappings.map((mapping) => (
            <div className="item-row" key={mapping.form_id}>
              <span className="item-main">
                <strong>{mapping.form_name}</strong>
                <span className="item-meta">
                  Formulaire <code>{mapping.form_id}</code> · campagne #{mapping.campaign_id} · source #{mapping.source_id}
                </span>
              </span>
              <span className="item-actions">
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={mapping.enabled}
                    onChange={(event) =>
                      setCfg({
                        ...cfg,
                        mappings: cfg.mappings.map((item) =>
                          item.form_id === mapping.form_id
                            ? { ...item, enabled: event.target.checked }
                            : item,
                        ),
                      })
                    }
                  />
                  Actif
                </label>
                <button
                  onClick={() =>
                    setCfg({
                      ...cfg,
                      mappings: cfg.mappings.filter(
                        (item) => item.form_id !== mapping.form_id,
                      ),
                    })
                  }
                >
                  Retirer
                </button>
              </span>
            </div>
          ))}
          <div className="form-row">
            <input
              aria-label="Identifiant du formulaire Meta"
              value={formId}
              placeholder="Identifiant du formulaire"
              onChange={(event) => setFormId(event.target.value)}
            />
            <input
              aria-label="Nom du formulaire Meta"
              value={formName}
              placeholder="Nom lisible"
              onChange={(event) => setFormName(event.target.value)}
            />
          </div>
          <CampaignSourcePicker value={destination} onChange={setDestination} />
          <button
            onClick={addMapping}
            disabled={
              !formId.trim() ||
              !formName.trim() ||
              !destination.campaign_id ||
              !destination.source_id
            }
          >
            Ajouter cette correspondance
          </button>
        </div>

        <label className="check-line">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(event) => setCfg({ ...cfg, enabled: event.target.checked })}
          />
          Activer la réception des leads Meta
        </label>
        <Stats
          label="Traitement des leads Meta"
          items={[
            { value: cfg.received, caption: "reçus" },
            { value: cfg.processed, caption: "traités" },
            { value: cfg.failed, caption: "en erreur" },
          ]}
        />
        <p className="field-note">
          Dernier événement : {formatDate(cfg.last_event_at)} · dernier succès :{" "}
          {formatDate(cfg.last_success_at)}
        </p>
        {cfg.last_error && <p className="error">Dernière erreur : {cfg.last_error}</p>}
        <div className="actions-bar">
          <button className="primary" onClick={save} disabled={busy}>
            Enregistrer Meta
          </button>
          <button onClick={simulate} disabled={busy || !cfg.mappings.some((m) => m.enabled)}>
            Créer un lead fictif
          </button>
          {simulatedId && <Link href={`/prospects/${simulatedId}`}>Ouvrir le prospect test</Link>}
          <Feedback notice={notice} error={error} />
        </div>
      </div>
    </section>
  );
}

