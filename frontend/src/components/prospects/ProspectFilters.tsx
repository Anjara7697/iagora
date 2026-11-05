"use client";

/**
 * Panneau « Filtres » de la liste des prospects (panneau latéral) : étape, campagne, source, programme, intérêt,
 * canal, consentement et prospects fictifs. Chaque choix s'applique tout de suite à l'adresse et à la liste.
 */

import { SlidersHorizontal } from "lucide-react";
import { Drawer } from "@/components/Drawer";
import { Btn, Check, ErrorText, SelectInput } from "@/components/ds/controls";
import { CHANNELS, CONSENT, LEVELS, STAGES, TARGETS } from "@/lib/labels";
import type { ProspectResults } from "@/lib/prospectResults";
import type { useApi } from "@/lib/useApi";
import type { Campaign, Page } from "@/lib/types";

const option = (options: Record<string, string>, all: string) => [
  { value: "", label: all },
  ...Object.entries(options).map(([value, text]) => ({ value, label: text })),
];

export function ProspectFilters({
  open,
  onClose,
  state,
  update,
  campaigns,
  total,
  panelCount,
}: {
  open: boolean;
  onClose: () => void;
  state: ProspectResults;
  update: (patch: Partial<ProspectResults>) => void;
  campaigns: ReturnType<typeof useApi<Page<Campaign>>>;
  /** Nombre de prospects affichés avec ces filtres, `null` tant qu'il n'est pas chargé. */
  total: number | null;
  /** Filtres du panneau actifs (le bouton « Retirer ces filtres » est inactif sans eux). */
  panelCount: number;
}) {
  const { stage, campaign, sourceFilter, targetCode, levelFilter, channelFilter, consentFilter, hideDemo } = state;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Prospects"
      title="Filtres"
      icon={<SlidersHorizontal aria-hidden="true" />}
    >
      {/* Chaque choix s'applique tout de suite ; la liste se met à jour derrière le panneau. */}
      <div className="flex flex-col gap-4">
        <SelectInput
          id="stage-filter"
          label="Étape"
          value={stage}
          onChange={(value) => update({ stage: value })}
          options={option(STAGES, "Toutes les étapes")}
        />
        <SelectInput
          id="campaign-filter"
          label="Campagne"
          value={campaign}
          disabled={campaigns.loading || !!campaigns.error}
          onChange={(value) => update({ campaign: value, sourceFilter: "" })}
          options={[
            { value: "", label: "Toutes" },
            ...(campaigns.data?.items.map((c) => ({ value: String(c.id), label: c.name })) ?? []),
          ]}
        />
        {campaigns.error && (
          <ErrorText>
            {`Filtre des campagnes indisponible : ${campaigns.error.message}`}
          </ErrorText>
        )}
        {campaigns.error && (
          <div>
            <Btn size="sm" variant="secondary" onClick={campaigns.reload}>
              Réessayer les campagnes
            </Btn>
          </div>
        )}
        <SelectInput
          id="source-filter"
          label="Source"
          value={sourceFilter}
          disabled={!campaign || campaigns.loading || !!campaigns.error}
          onChange={(value) => update({ sourceFilter: value })}
          options={[
            { value: "", label: campaign ? "Toutes" : "Campagne d’abord" },
            ...(campaigns.data?.items
              .find((c) => c.id === Number(campaign))
              ?.sources?.map((s) => ({ value: String(s.id), label: s.name })) ?? []),
          ]}
        />
        <SelectInput id="target-filter" label="Programme" value={targetCode} onChange={(value) => update({ targetCode: value })} options={option(TARGETS, "Tous les programmes")} />
        <SelectInput id="level-filter" label="Intérêt" value={levelFilter} onChange={(value) => update({ levelFilter: value })} options={option(LEVELS, "Tous les niveaux")} />
        <SelectInput id="channel-filter" label="Canal" value={channelFilter} onChange={(value) => update({ channelFilter: value })} options={option(CHANNELS, "Tous les canaux")} />
        <SelectInput id="consent-filter" label="Consentement" value={consentFilter} onChange={(value) => update({ consentFilter: value })} options={option(CONSENT, "Tous")} />
        <Check checked={hideDemo} onChange={(value) => update({ hideDemo: value })}>
          Masquer les prospects fictifs
        </Check>
        <div className="flex flex-wrap gap-2 border-t border-separator pt-4">
          <Btn variant="primary" onClick={onClose}>
            {total !== null ? `Afficher ${total} prospect${total > 1 ? "s" : ""}` : "Afficher les prospects"}
          </Btn>
          <Btn variant="secondary" disabled={!panelCount} onClick={() => update({ stage: "", campaign: "", sourceFilter: "", targetCode: "", levelFilter: "", channelFilter: "", consentFilter: "", hideDemo: false })}>
            Retirer ces filtres
          </Btn>
        </div>
      </div>
    </Drawer>
  );
}
