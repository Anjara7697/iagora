"use client";

import { useState } from "react";
import CampaignAgentFiles from "@/components/campaign/CampaignAgentFiles";
import CampaignBrief from "@/components/campaign/CampaignBrief";
import CampaignAgentModes from "@/components/campaign/CampaignAgentModes";
import CampaignAgentResources from "@/components/campaign/CampaignAgentResources";
import CampaignOwnership from "@/components/campaign/CampaignOwnership";
import { Btn, CheckCardGroup, Tag } from "@/components/ds/controls";
import { Panel } from "@/components/ds/layout";
import { TARGETS, label } from "@/lib/labels";
import type { Campaign, Target } from "@/lib/types";

/** Réglages d'une campagne : responsable, programmes visés, fiche, autonomie et ressources de l'agent (modifiables par l'administrateur). Le statut est dans l'en-tête. */
export default function CampaignSettings({
  campaign,
  targets,
  canEdit,
  busy,
  onPatch,
  onOwnerDone,
}: {
  campaign: Campaign;
  targets: Target[] | null;
  canEdit: boolean;
  busy: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onOwnerDone: () => void;
}) {
  const initial = campaign.targets.map((t) => t.code);
  const [codes, setCodes] = useState<string[]>(initial);
  const changed = codes.length !== initial.length || codes.some((c) => !initial.includes(c));
  return (
    <div className="flex flex-col gap-4">
      <p className="type-body text-muted">{canEdit ? "Responsable et programmes visés. Le statut se change dans l’en-tête." : "Consultation seule : réservé aux administrateurs."}</p>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <CampaignOwnership key={`${campaign.id}:${campaign.responsible_advisor_id}`} campaign={campaign} onDone={onOwnerDone} />
        <Panel title="Programmes visés" label="Programmes visés">
          {canEdit && targets ? (
            <div className="flex flex-col gap-4">
              <CheckCardGroup
                label="Programmes visés"
                hideLabel
                options={targets.map((t) => ({ value: t.code, text: t.name }))}
                value={codes}
                onChange={setCodes}
              />
              <Btn
                variant="secondary"
                className="w-fit"
                disabled={busy || !changed}
                onClick={() => onPatch({ target_codes: codes })}
              >
                Enregistrer les programmes
              </Btn>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {campaign.targets.map((t) => (
                <Tag key={t.code} tone="accent">
                  {label(TARGETS, t.code)}
                </Tag>
              ))}
              {campaign.targets.length === 0 && <span className="type-body text-muted">Aucun programme.</span>}
            </div>
          )}
        </Panel>
      </div>
      <CampaignBrief key={`brief:${campaign.id}:${campaign.updated_at}`} campaign={campaign} canEdit={canEdit} busy={busy} onPatch={onPatch} />
      <CampaignAgentModes campaignId={campaign.id} canEdit={canEdit} />
      <CampaignAgentResources
        key={`${campaign.id}:${campaign.updated_at}`}
        campaign={campaign}
        canEdit={canEdit}
        busy={busy}
        onPatch={onPatch}
      />
      <CampaignAgentFiles campaignId={campaign.id} canEdit={canEdit} />
    </div>
  );
}
