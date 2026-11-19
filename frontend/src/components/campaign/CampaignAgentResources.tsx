"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Btn, Field, TextInput } from "@/components/ds/controls";
import { Panel } from "@/components/ds/layout";
import { isHttpsUrl } from "@/lib/links";
import type { Campaign } from "@/lib/types";

type Resource = { label: string; url: string; usage: string };

const MAX_RESOURCES = 20;
const EMPTY: Resource = { label: "", url: "", usage: "" };

/**
 * Ce que l'agent peut utiliser pour cette campagne (D-39) : l'objet imposé du premier email (sinon écrit par l'agent)
 * et les liens validés qu'il peut proposer. Aucun autre lien ne part : le garde-fou les bloque.
 */
export default function CampaignAgentResources({
  campaign,
  canEdit,
  busy,
  onPatch,
}: {
  campaign: Campaign;
  canEdit: boolean;
  busy: boolean;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const initialSubject = campaign.email_subject ?? "";
  const initialResources: Resource[] = (campaign.resources ?? []).map((r) => ({ label: r.label, url: r.url, usage: r.usage ?? "" }));
  const [subject, setSubject] = useState(initialSubject);
  const [resources, setResources] = useState<Resource[]>(initialResources);

  const update = (index: number, patch: Partial<Resource>) =>
    setResources((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const filled = resources.filter((r) => r.label.trim() || r.url.trim() || r.usage.trim());
  const invalid = filled.some((r) => !r.label.trim() || !isHttpsUrl(r.url));
  const changed = subject.trim() !== initialSubject.trim() || JSON.stringify(filled) !== JSON.stringify(initialResources);

  if (!canEdit) {
    return (
      <Panel title="Pour l’agent" label="Pour l’agent">
        <div className="flex flex-col gap-3 type-body">
          <p className="text-muted">Objet du premier email : {initialSubject || "écrit par l’agent"}</p>
          {initialResources.length === 0 ? (
            <p className="text-muted">Aucun lien validé.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {initialResources.map((r) => (
                <li key={r.url}>
                  <span className="font-medium text-foreground">{r.label}</span> <span className="text-muted">{r.url}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Pour l’agent" label="Pour l’agent">
      <div className="flex flex-col gap-5">
        <Field
          label="Objet du premier email"
          hint="Laisser vide : l’agent écrit un objet personnalisé. « {prénom} » est remplacé par le prénom du prospect."
        >
          <TextInput value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="ex. {prénom}, votre projet et le Master eBIHAR" />
        </Field>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 type-body font-semibold text-foreground">Liens validés</legend>
          <p className="type-body-sm text-muted">
            Les seuls liens que l’agent peut proposer, quand ils répondent au besoin du prospect. Tout autre lien est bloqué.
          </p>
          {resources.map((r, index) => (
            <div key={index} className="grid grid-cols-1 items-end gap-3 rounded-lg border border-separator p-3 md:grid-cols-[1fr_1.4fr_1.4fr_auto]">
              <Field label={`Nom du lien ${index + 1}`}>
                <TextInput value={r.label} maxLength={120} onChange={(e) => update(index, { label: e.target.value })} placeholder="ex. Inscription" />
              </Field>
              <Field label="Adresse (https://)">
                <TextInput
                  value={r.url}
                  maxLength={500}
                  inputMode="url"
                  aria-invalid={r.url.trim() !== "" && !isHttpsUrl(r.url)}
                  onChange={(e) => update(index, { url: e.target.value })}
                  placeholder="https://…"
                />
              </Field>
              <Field label="Quand le proposer">
                <TextInput value={r.usage} maxLength={300} onChange={(e) => update(index, { usage: e.target.value })} placeholder="ex. quand le prospect veut s’inscrire" />
              </Field>
              <Btn variant="tertiary" isIconOnly aria-label={`Retirer le lien ${index + 1}`} onClick={() => setResources((list) => list.filter((_, i) => i !== index))}>
                <X className="size-4" aria-hidden="true" />
              </Btn>
            </div>
          ))}
          {invalid && <p className="type-body-sm text-danger">Chaque lien a besoin d’un nom et d’une adresse complète en https://.</p>}
          <Btn
            variant="secondary"
            className="w-fit"
            disabled={resources.length >= MAX_RESOURCES}
            onClick={() => setResources((list) => [...list, { ...EMPTY }])}
          >
            <Plus className="size-4" aria-hidden="true" />
            Ajouter un lien
          </Btn>
        </fieldset>

        <Btn
          variant="primary"
          className="w-fit rounded-lg"
          disabled={busy || invalid || !changed}
          onClick={() =>
            onPatch({
              email_subject: subject.trim() || null,
              resources: filled.map((r) => ({ label: r.label.trim(), url: r.url.trim(), usage: r.usage.trim() })),
            })
          }
        >
          Enregistrer pour l’agent
        </Btn>
      </div>
    </Panel>
  );
}
