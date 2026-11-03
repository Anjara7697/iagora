"use client";

import { Plus, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Btn, Check, ErrorText, Field, SelectBox, TextBox, TextInput } from "@/components/ds/controls";
import { DateRangeField } from "@/components/ds/DateRangeField";
import { ActionsBar } from "@/components/ds/settings";
import { Stepper, type Step } from "@/components/ds/Stepper";
import { PLATFORMS, SOURCE_TYPES, formatDay } from "@/lib/labels";
import type { Target } from "@/lib/types";
import { Box } from "@/components/ds/card";

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

const STEPS: Step[] = [
  { id: "basics", title: "Informations", description: "Nom, description et statut" },
  { id: "targeting", title: "Période et ciblage", description: "Dates et programmes visés" },
  { id: "sources", title: "Sources", description: "D’où viennent les prospects" },
];

/** Champs en `rounded-lg` : le rayon des champs HeroUI se règle par cette variable, pour tous les composants du formulaire. */
const FIELD_RADIUS = { "--field-radius": "var(--radius-lg)" } as CSSProperties;

/**
 * Nom, description, statut, période et programmes visés ; les sources seulement à la création.
 * Avec `steps` (création), le formulaire se déroule en trois étapes : informations, période et ciblage, sources.
 */
export default function CampaignForm({
  initial,
  targets,
  withSources,
  steps = false,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial: CampaignValues;
  targets: Target[];
  withSources: boolean;
  steps?: boolean;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (values: CampaignValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<CampaignValues>(initial);
  const [step, setStep] = useState(0);
  const set = <K extends keyof CampaignValues>(key: K, value: CampaignValues[K]) =>
    setV((current) => ({ ...current, [key]: value }));
  const last = STEPS.length - 1;
  const valid = v.name.trim().length > 0;
  const stepValid = step === 0 ? valid : true;
  const show = (index: number) => !steps || step === index;

  function toggleTarget(code: string) {
    set("target_codes", v.target_codes.includes(code) ? v.target_codes.filter((c) => c !== code) : [...v.target_codes, code]);
  }
  function setSource(index: number, patch: Partial<SourceDraft>) {
    set("sources", v.sources.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  return (
    <Box
      as="form"
      className="gap-5 rounded-lg p-5"
      style={FIELD_RADIUS}
      aria-label="Campagne"
      onSubmit={(e) => {
        e.preventDefault();
        if (steps && step < last) {
          if (stepValid) setStep(step + 1);
        } else if (valid) onSubmit(v);
      }}
    >
      {steps && <Stepper label="Étapes de création" steps={STEPS} current={step} onSelect={setStep} />}

      {show(0) && (
        <section className="flex flex-col gap-4" aria-label={steps ? STEPS[0].title : undefined}>
          <Field label="Nom de la campagne">
            <TextInput
              variant="secondary"
              value={v.name}
              maxLength={200}
              onChange={(e) => set("name", e.target.value)}
              required
              placeholder="ex. Rentrée 2027"
            />
          </Field>
          <Field label="Description" hint="Visible par l’équipe ; l’agent ne l’envoie jamais au prospect.">
            <TextBox variant="secondary" value={v.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="Statut">
            <SelectBox variant="secondary" fullWidth={false} className="w-full sm:w-64" value={v.status} onChange={(e) => set("status", e.target.value)}>
              <option value="draft">Brouillon</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </SelectBox>
          </Field>
        </section>
      )}

      {show(1) && (
        <section className="flex flex-col gap-5" aria-label={steps ? STEPS[1].title : undefined}>
          <DateRangeField
            variant="secondary"
            label="Période de la campagne"
            hint="Début et fin. Laissez vide pour une campagne sans dates."
            start={v.start_date}
            end={v.end_date}
            onChange={(start, end) => setV((current) => ({ ...current, start_date: start, end_date: end }))}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="float-left mb-3 w-full text-[13px] font-medium text-foreground">Programmes visés</legend>
            <div className="clear-both grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {targets.map((t) => (
                <Check
                  key={t.code}
                  checked={v.target_codes.includes(t.code)}
                  onChange={() => toggleTarget(t.code)}
                  className="rounded-lg border border-border px-3 py-2.5"
                >
                  {t.name}
                </Check>
              ))}
            </div>
          </fieldset>
        </section>
      )}

      {withSources && show(2) && (
        <section className="flex flex-col gap-4" aria-label={steps ? STEPS[2].title : undefined}>
          <fieldset className="flex flex-col gap-3">
            <legend className="float-left mb-1 w-full text-[13px] font-medium text-foreground">Sources de prospects</legend>
            <p className="clear-both text-xs text-muted">
              D’où viennent les personnes : une publicité, un formulaire, un salon… Vous pourrez en ajouter plus tard.
            </p>
            {v.sources.map((s, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-2 rounded-lg border border-separator p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
              >
                <TextInput
                  variant="secondary"
                  aria-label={`Nom de la source ${i + 1}`}
                  placeholder="Nom (ex. LinkedIn Ads)"
                  value={s.name}
                  onChange={(e) => setSource(i, { name: e.target.value })}
                />
                <SelectBox
                  variant="secondary"
                  aria-label={`Type de la source ${i + 1}`}
                  value={s.type}
                  onChange={(e) => setSource(i, { type: e.target.value })}
                >
                  {Object.entries(SOURCE_TYPES).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </SelectBox>
                <SelectBox
                  variant="secondary"
                  aria-label={`Plateforme de la source ${i + 1}`}
                  value={s.platform}
                  onChange={(e) => setSource(i, { platform: e.target.value })}
                >
                  {Object.entries(PLATFORMS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </SelectBox>
                <Btn variant="ghost" size="sm" className="rounded-lg" onClick={() => set("sources", v.sources.filter((_, j) => j !== i))}>
                  <X className="size-4" aria-hidden="true" />
                  Retirer
                </Btn>
              </div>
            ))}
            <Btn
              variant="outline"
              size="sm"
              className="w-fit rounded-lg"
              onClick={() => set("sources", [...v.sources, { name: "", type: "ads", platform: "linkedin", external_id: "" }])}
            >
              <Plus className="size-4" aria-hidden="true" />
              Ajouter une source
            </Btn>
          </fieldset>

          {steps && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg bg-surface-secondary p-3 text-[13px]" aria-label="Récapitulatif">
              <dt className="text-muted">Campagne</dt>
              <dd className="font-medium text-foreground">{v.name.trim() || "—"}</dd>
              <dt className="text-muted">Période</dt>
              <dd>{v.start_date && v.end_date ? `${formatDay(v.start_date)} → ${formatDay(v.end_date)}` : "Sans dates"}</dd>
              <dt className="text-muted">Programmes</dt>
              <dd>{v.target_codes.length || "Aucun"}</dd>
              <dt className="text-muted">Sources</dt>
              <dd>{v.sources.filter((s) => s.name.trim()).length || "Aucune"}</dd>
            </dl>
          )}
        </section>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <ActionsBar className="border-t border-separator pt-4">
        {steps && step > 0 && (
          <Btn className="rounded-lg" disabled={busy} onClick={() => setStep(step - 1)}>
            Retour
          </Btn>
        )}
        {steps && step < last ? (
          <Btn variant="primary" className="rounded-lg" type="submit" disabled={!stepValid}>
            Continuer
          </Btn>
        ) : (
          <Btn variant="primary" className="rounded-lg" type="submit" disabled={busy || !valid}>
            {busy ? "Enregistrement…" : submitLabel}
          </Btn>
        )}
        <Btn variant="ghost" className="rounded-lg" disabled={busy} onClick={onCancel}>
          Annuler
        </Btn>
      </ActionsBar>
    </Box>
  );
}
