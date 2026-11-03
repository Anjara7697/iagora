"use client";

import { useState, type CSSProperties } from "react";
import { Btn, CheckCardGroup, ErrorText, Field, SelectBox, TextBox, TextInput } from "@/components/ds/controls";
import { DateRangeField } from "@/components/ds/DateRangeField";
import { ActionsBar } from "@/components/ds/settings";
import { Stepper, type Step } from "@/components/ds/Stepper";
import { formatDay } from "@/lib/labels";
import type { Target } from "@/lib/types";
import { Box } from "@/components/ds/card";
import SourceConnectors, { type SourceDraft } from "@/components/SourceConnectors";

export type { SourceDraft };

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
          <div className="flex flex-col gap-2">
            <CheckCardGroup
              label="Programmes visés"
              description="Sans programme coché, le sujet d’intérêt des prospects n’est pas pré-rempli : l’agent le déduit de leur message."
              options={targets.map((t) => ({ value: t.code, text: t.name }))}
              value={v.target_codes}
              onChange={(codes) => set("target_codes", codes)}
            />
            {targets.length > 1 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted" role="status">
                  {v.target_codes.length} sur {targets.length} sélectionné{v.target_codes.length > 1 ? "s" : ""}
                </span>
                <Btn
                  variant="ghost"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => set("target_codes", v.target_codes.length === targets.length ? [] : targets.map((t) => t.code))}
                >
                  {v.target_codes.length === targets.length ? "Tout désélectionner" : "Tout sélectionner"}
                </Btn>
              </div>
            )}
          </div>
        </section>
      )}

      {withSources && show(2) && (
        <section className="flex flex-col gap-4" aria-label={steps ? STEPS[2].title : undefined}>
          <SourceConnectors value={v.sources} onChange={(sources) => set("sources", sources)} />

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
