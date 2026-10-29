"use client";

import { useState } from "react";
import { PLATFORMS, SOURCE_TYPES } from "@/lib/labels";
import type { Target } from "@/lib/types";

export type SourceDraft = {
  name: string;
  type: string;
  platform: string;
  external_id: string;
};

export type CampaignValues = {
  name: string;
  description: string;
  status: string;
  start_date: string;
  end_date: string;
  target_codes: string[];
  sources: SourceDraft[];
};

export const EMPTY_VALUES: CampaignValues = {
  name: "",
  description: "",
  status: "draft",
  start_date: "",
  end_date: "",
  target_codes: [],
  sources: [],
};

/** Nom, description, statut, dates et programmes visés ; les sources seulement à la création. */
export default function CampaignForm({
  initial,
  targets,
  withSources,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial: CampaignValues;
  targets: Target[];
  withSources: boolean;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (values: CampaignValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<CampaignValues>(initial);
  const set = <K extends keyof CampaignValues>(
    key: K,
    value: CampaignValues[K],
  ) => setV((current) => ({ ...current, [key]: value }));
  const datesInvalid =
    !!v.start_date && !!v.end_date && v.end_date < v.start_date;
  const valid = v.name.trim().length > 0 && !datesInvalid;

  function toggleTarget(code: string) {
    set(
      "target_codes",
      v.target_codes.includes(code)
        ? v.target_codes.filter((c) => c !== code)
        : [...v.target_codes, code],
    );
  }
  function setSource(index: number, patch: Partial<SourceDraft>) {
    set(
      "sources",
      v.sources.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }

  return (
    <form
      className="ui-card campaign-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(v);
      }}
    >
      <label>
        Nom de la campagne
        <input
          aria-label="Nom de la campagne"
          value={v.name}
          maxLength={200}
          onChange={(e) => set("name", e.target.value)}
          required
        />
      </label>
      <label>
        Description
        <textarea
          aria-label="Description"
          value={v.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <div className="form-row">
        <label>
          Statut
          <select
            aria-label="Statut"
            value={v.status}
            onChange={(e) => set("status", e.target.value)}
          >
            <option value="draft">Brouillon</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label>
          Début
          <input
            type="date"
            aria-label="Date de début"
            value={v.start_date}
            onChange={(e) => set("start_date", e.target.value)}
          />
        </label>
        <label>
          Fin
          <input
            type="date"
            aria-label="Date de fin"
            value={v.end_date}
            onChange={(e) => set("end_date", e.target.value)}
          />
        </label>
      </div>
      {datesInvalid && (
        <p className="error" role="alert">
          La date de fin doit être postérieure à la date de début.
        </p>
      )}

      <fieldset>
        <legend>Programmes visés</legend>
        <div className="checks">
          {targets.map((t) => (
            <label key={t.code} className="check">
              <input
                type="checkbox"
                checked={v.target_codes.includes(t.code)}
                onChange={() => toggleTarget(t.code)}
              />
              {t.name}
            </label>
          ))}
        </div>
      </fieldset>

      {withSources && (
        <fieldset>
          <legend>Sources de prospects</legend>
          {v.sources.map((s, i) => (
            <div key={i} className="source-row">
              <input
                aria-label={`Nom de la source ${i + 1}`}
                placeholder="Nom (ex. LinkedIn Ads)"
                value={s.name}
                onChange={(e) => setSource(i, { name: e.target.value })}
              />
              <select
                aria-label={`Type de la source ${i + 1}`}
                value={s.type}
                onChange={(e) => setSource(i, { type: e.target.value })}
              >
                {Object.entries(SOURCE_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Plateforme de la source ${i + 1}`}
                value={s.platform}
                onChange={(e) => setSource(i, { platform: e.target.value })}
              >
                {Object.entries(PLATFORMS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  set(
                    "sources",
                    v.sources.filter((_, j) => j !== i),
                  )
                }
              >
                Retirer
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set("sources", [
                ...v.sources,
                {
                  name: "",
                  type: "ads",
                  platform: "linkedin",
                  external_id: "",
                },
              ])
            }
          >
            Ajouter une source
          </button>
        </fieldset>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="primary" disabled={busy || !valid}>
          {busy ? "Enregistrement…" : submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
