"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Btn, Check, ErrorText, Field, NativeSelect, TextBox, TextInput } from "@/components/ds/controls";
import { ActionsBar } from "@/components/ds/settings";
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
     
      className="card card--default gap-5 p-5"
      aria-label="Campagne"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(v);
      }}
    >
      <Field label="Nom de la campagne">
        <TextInput
          value={v.name}
          maxLength={200}
          onChange={(e) => set("name", e.target.value)}
          required
          placeholder="ex. Rentrée 2027"
        />
      </Field>
      <Field label="Description" hint="Visible par l’équipe ; l’agent ne l’envoie jamais au prospect.">
        <TextBox value={v.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Statut">
          <NativeSelect value={v.status} onChange={(e) => set("status", e.target.value)}>
            <option value="draft">Brouillon</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelect>
        </Field>
        <Field label="Date de début">
          <TextInput type="date" value={v.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </Field>
        <Field label="Date de fin">
          <TextInput type="date" value={v.end_date} onChange={(e) => set("end_date", e.target.value)} />
        </Field>
      </div>
      {datesInvalid && <ErrorText>La date de fin doit être postérieure à la date de début.</ErrorText>}

      <fieldset className="flex flex-col gap-3 border-t border-separator pt-4">
        <legend className="float-left mb-3 w-full text-[13px] font-medium text-foreground">Programmes visés</legend>
        <div className="clear-both grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {targets.map((t) => (
            <Check
              key={t.code}
              checked={v.target_codes.includes(t.code)}
              onChange={() => toggleTarget(t.code)}
              className="rounded-xl border border-border px-3 py-2.5"
            >
              {t.name}
            </Check>
          ))}
        </div>
      </fieldset>

      {withSources && (
        <fieldset className="flex flex-col gap-3 border-t border-separator pt-4">
          <legend className="float-left mb-1 w-full text-[13px] font-medium text-foreground">Sources de prospects</legend>
          <p className="clear-both text-xs text-muted">
            D’où viennent les personnes : une publicité, un formulaire, un salon… Vous pourrez en ajouter plus tard.
          </p>
          {v.sources.map((s, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-2 rounded-xl bg-surface-secondary p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
            >
              <TextInput
                aria-label={`Nom de la source ${i + 1}`}
                placeholder="Nom (ex. LinkedIn Ads)"
                value={s.name}
                onChange={(e) => setSource(i, { name: e.target.value })}
              />
              <NativeSelect
                aria-label={`Type de la source ${i + 1}`}
                value={s.type}
                onChange={(e) => setSource(i, { type: e.target.value })}
              >
                {Object.entries(SOURCE_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label={`Plateforme de la source ${i + 1}`}
                value={s.platform}
                onChange={(e) => setSource(i, { platform: e.target.value })}
              >
                {Object.entries(PLATFORMS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <Btn
                variant="ghost"
                size="sm"
                onClick={() =>
                  set(
                    "sources",
                    v.sources.filter((_, j) => j !== i),
                  )
                }
              >
                <X className="size-4" aria-hidden="true" />
                Retirer
              </Btn>
            </div>
          ))}
          <Btn
            variant="outline"
            size="sm"
            className="w-fit"
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
            <Plus className="size-4" aria-hidden="true" />
            Ajouter une source
          </Btn>
        </fieldset>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <ActionsBar className="border-t border-separator pt-4">
        <Btn variant="primary" type="submit" disabled={busy || !valid}>
          {busy ? "Enregistrement…" : submitLabel}
        </Btn>
        <Btn disabled={busy} onClick={onCancel}>
          Annuler
        </Btn>
      </ActionsBar>
    </form>
  );
}
