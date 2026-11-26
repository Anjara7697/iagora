"use client";

import { useState } from "react";
import { Btn, Field, TextBox } from "@/components/ds/controls";
import { Panel } from "@/components/ds/layout";
import type { Campaign } from "@/lib/types";
import { campaignEnded } from "@/lib/campaignDates";

type Brief = { offer: string; key_dates: string; conditions: string; avoid: string };
type Key = keyof Brief;

const FIELDS: { key: Key; label: string; hint: string; placeholder: string; max: number }[] = [
  {
    key: "offer",
    label: "Offre et message clé",
    hint: "Ce que cette campagne met en avant. L’agent peut le citer.",
    placeholder: "ex. Rentrée de janvier en alternance : frais de dossier offerts",
    max: 800,
  },
  {
    key: "key_dates",
    label: "Dates importantes",
    hint: "Rentrée, date limite, événement. Une par ligne.",
    placeholder: "ex. Date limite de candidature : 15 décembre\nRentrée : 12 janvier",
    max: 600,
  },
  {
    key: "conditions",
    label: "Conditions particulières",
    hint: "Tarif, places, public visé. L’agent peut les citer telles quelles.",
    placeholder: "ex. 30 places. Offre réservée aux candidatures déposées avant le 15 décembre.",
    max: 800,
  },
  {
    key: "avoid",
    label: "À ne pas dire",
    hint: "Ce que l’agent ne doit ni dire ni promettre dans cette campagne. Ce n’est jamais une source.",
    placeholder: "ex. Ne pas parler de la rentrée de septembre.",
    max: 600,
  },
];

/**
 * Fiche de la campagne (D-52) : ce qui la distingue, donné à l'agent à chaque message. Offre, dates et conditions sont des faits
 * validés que l'agent peut citer, prioritaires sur la base de connaissances ; après la date de fin, la fiche n'est plus donnée.
 */
export default function CampaignBrief({
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
  const initial: Brief = {
    offer: campaign.brief?.offer ?? "",
    key_dates: campaign.brief?.key_dates ?? "",
    conditions: campaign.brief?.conditions ?? "",
    avoid: campaign.brief?.avoid ?? "",
  };
  const [brief, setBrief] = useState<Brief>(initial);
  const changed = FIELDS.some(({ key }) => brief[key].trim() !== initial[key].trim());
  const ended = campaignEnded(campaign.end_date);
  const intro = ended
    ? "Campagne terminée : l’agent ne reçoit plus cette fiche."
    : "Ce qui est propre à cette campagne. L’agent la lit à chaque message et la fait passer avant la base de connaissances.";

  if (!canEdit) {
    const filled = FIELDS.filter(({ key }) => initial[key]);
    return (
      <Panel title="Fiche de la campagne" label="Fiche de la campagne">
        <div className="flex flex-col gap-3 type-body">
          <p className="text-muted">{intro}</p>
          {filled.length === 0 ? (
            <p className="text-muted">Aucune information propre à cette campagne.</p>
          ) : (
            <dl className="flex flex-col gap-2">
              {filled.map(({ key, label }) => (
                <div key={key}>
                  <dt className="font-medium text-foreground">{label}</dt>
                  <dd className="whitespace-pre-line text-muted">{initial[key]}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Fiche de la campagne" label="Fiche de la campagne">
      <div className="flex flex-col gap-5">
        <p className="type-body-sm text-muted">{intro}</p>
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
          {FIELDS.map(({ key, label, hint, placeholder, max }) => (
            <Field key={key} label={label} hint={hint}>
              <TextBox
                rows={3}
                value={brief[key]}
                maxLength={max}
                placeholder={placeholder}
                onChange={(e) => setBrief((b) => ({ ...b, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <Btn
          variant="secondary"
          className="w-fit"
          disabled={busy || !changed}
          onClick={() =>
            onPatch({
              brief: Object.fromEntries(FIELDS.map(({ key }) => [key, brief[key].trim()])),
            })
          }
        >
          Enregistrer la fiche
        </Btn>
      </div>
    </Panel>
  );
}
