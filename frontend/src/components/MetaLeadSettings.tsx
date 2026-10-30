"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Plus } from "lucide-react";
import { API_URL, api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { MetaFormMapping, MetaSettings } from "@/lib/types";
import { CampaignSourcePicker } from "./CampaignSourcePicker";
import { Btn, Check, ErrorText, TextInput, TextLink } from "./ds/controls";
import { Eyebrow } from "./ds/layout";
import { ActionsBar, CodeBlock, Feedback, InfoRow, SettingRow as Field, StatePill, Stats } from "./ds/settings";

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

/** `embedded` : affiché dans un panneau qui porte déjà le titre et l'état. */
export function MetaLeadSettings({ embedded = false }: { embedded?: boolean }) {
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
      <section className="flex flex-col gap-3" aria-label="Meta Lead Ads">
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-sm text-muted" role="status">
            Chargement…
          </p>
        )}
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
    <section
     
      className={embedded ? "flex flex-col gap-4" : "card card--default gap-4 p-5"}
      aria-label="Meta Lead Ads"
    >
      {!embedded && (
        <div className="flex flex-col gap-1">
          <Eyebrow>Source de leads · Facebook et Instagram</Eyebrow>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex-1 text-base font-semibold text-foreground">Meta Lead Ads</h2>
            <StatePill tone={tone}>{status}</StatePill>
          </div>
        </div>
      )}
      <p className="text-[13px]/[20px] text-muted">
        Reçoit les formulaires instantanés Meta, évite les doublons et range
        chaque prospect dans la campagne choisie. Les secrets sont chiffrés et
        ne sont jamais réaffichés.
      </p>
      <Field label="Identifiant de l’application Meta">
        <TextInput
          value={cfg.app_id}
          placeholder="1234567890"
          onChange={(event) => setCfg({ ...cfg, app_id: event.target.value })}
        />
      </Field>
      <Field label="Version de l’API Graph" note="À conserver alignée avec l’application Meta.">
        <TextInput
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
        <Field key={key} label={label} note="Vide : conserver la valeur enregistrée.">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={secrets[key]}
            placeholder={present ? "•••••• (inchangé)" : ""}
            onChange={(event) => setSecrets({ ...secrets, [key]: event.target.value })}
          />
        </Field>
      ))}
      <InfoRow
        label="URL du webhook"
        note="À copier dans Meta for Developers, avec le jeton de vérification choisi ci-dessus."
      >
        <CodeBlock>{webhookUrl}</CodeBlock>
      </InfoRow>

      <div className="flex flex-col gap-3 border-t border-separator pt-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-foreground">Correspondance des formulaires</h3>
          <p className="text-xs/[18px] text-muted">
            Un identifiant de formulaire Meta correspond à une seule source de
            campagne IAGORA.
          </p>
        </div>
        {cfg.mappings.map((mapping) => (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-separator px-4 py-3" key={mapping.form_id}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <strong className="text-sm font-semibold text-foreground">{mapping.form_name}</strong>
              <span className="text-xs text-muted">
                Formulaire <code className="rounded bg-surface-tertiary px-1 font-mono">{mapping.form_id}</code> · campagne #{mapping.campaign_id} · source #{mapping.source_id}
              </span>
            </span>
            <Check
              checked={mapping.enabled}
              onChange={(checked) =>
                setCfg({
                  ...cfg,
                  mappings: cfg.mappings.map((item) =>
                    item.form_id === mapping.form_id ? { ...item, enabled: checked } : item,
                  ),
                })
              }
            >
              Actif
            </Check>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() =>
                setCfg({
                  ...cfg,
                  mappings: cfg.mappings.filter((item) => item.form_id !== mapping.form_id),
                })
              }
            >
              Retirer
            </Btn>
          </div>
        ))}
        <div className="flex flex-col gap-3 rounded-xl bg-surface-secondary p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextInput
              aria-label="Identifiant du formulaire Meta"
              value={formId}
              placeholder="Identifiant du formulaire"
              onChange={(event) => setFormId(event.target.value)}
            />
            <TextInput
              aria-label="Nom du formulaire Meta"
              value={formName}
              placeholder="Nom lisible"
              onChange={(event) => setFormName(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <CampaignSourcePicker value={destination} onChange={setDestination} />
          </div>
          <Btn
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={addMapping}
            disabled={!formId.trim() || !formName.trim() || !destination.campaign_id || !destination.source_id}
          >
            <Plus className="size-4" aria-hidden="true" />
            Ajouter cette correspondance
          </Btn>
        </div>
      </div>

      <Check
        checked={cfg.enabled}
        onChange={(value) => setCfg({ ...cfg, enabled: value })}
        className="border-t border-separator pt-4 font-medium"
      >
        Activer la réception des leads Meta
      </Check>
      <Stats
        label="Traitement des leads Meta"
        items={[
          { value: cfg.received, caption: "reçus" },
          { value: cfg.processed, caption: "traités" },
          { value: cfg.failed, caption: "en erreur" },
        ]}
      />
      <p className="text-xs/[18px] text-muted">
        Dernier événement : {formatDate(cfg.last_event_at)} · dernier succès :{" "}
        {formatDate(cfg.last_success_at)}
      </p>
      {cfg.last_error && <ErrorText>Dernière erreur : {cfg.last_error}</ErrorText>}
      <ActionsBar className="border-t border-separator pt-4">
        <Btn variant="primary" onClick={save} disabled={busy}>
          Enregistrer Meta
        </Btn>
        <Btn onClick={simulate} disabled={busy || !cfg.mappings.some((m) => m.enabled)}>
          <FlaskConical className="size-4" aria-hidden="true" />
          Créer un lead fictif
        </Btn>
        {simulatedId && (
          <TextLink href={`/prospects/${simulatedId}`}>Ouvrir le prospect test</TextLink>
        )}
      </ActionsBar>
      <Feedback notice={notice} error={error} />
    </section>
  );
}
