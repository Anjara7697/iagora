"use client";

/** Constantes, petits éléments et filtres partagés par la liste des prospects (pipeline et table). */

import { Avatar as HeroAvatar } from "@heroui/react";
import { Tag } from "@/components/ds/controls";
import { CONSENT, label } from "@/lib/labels";
import type { ProspectResults } from "@/lib/prospectResults";
import type { Membership, Prospect } from "@/lib/types";

export const LIMIT = 25;
// Le pipeline affiche plus de prospects par page pour que les colonnes soient représentatives.
export const PIPELINE_LIMIT = 100;
export const PIPELINE_COLUMNS = [
  { key: "unassigned", title: "Sans campagne", stages: [] as string[] },
  { key: "new", title: "À qualifier", stages: ["new", "to_qualify"] },
  {
    key: "conversation",
    title: "En échange",
    stages: ["contacted", "in_conversation"],
  },
  { key: "qualified", title: "Qualifié", stages: ["qualified"] },
  {
    key: "meeting",
    title: "Rendez-vous",
    stages: ["meeting_proposed", "meeting_scheduled", "meeting_done"],
  },
  { key: "applied", title: "Candidature", stages: ["applied"] },
  { key: "converted", title: "Converti", stages: ["converted"] },
  { key: "follow_up", title: "À relancer", stages: ["to_follow_up"] },
  { key: "exit", title: "Sorties", stages: ["lost"] },
];
export const level = (t: number) =>
  t >= 75 ? "very_hot" : t >= 50 ? "hot" : t >= 25 ? "warm" : "cold";
export function ProspectAvatar({ prospect, size = "sm" }: { prospect: Prospect; size?: "sm" | "md" }) {
  return (
    <HeroAvatar size={size} variant="soft" color="accent" aria-hidden="true">
      <HeroAvatar.Fallback>
        {[prospect.first_name, prospect.last_name]
          .filter(Boolean)
          .map((s) => s![0])
          .join("")
          .slice(0, 2)
          .toUpperCase() || "?"}
      </HeroAvatar.Fallback>
    </HeroAvatar>
  );
}

export const CONSENT_TONE: Record<string, "success" | "danger" | "neutral" | "warning"> = {
  granted: "success",
  opted_out: "danger",
  pending: "warning",
};

export function ConsentTag({ status }: { status: string }) {
  return <Tag tone={CONSENT_TONE[status] ?? "neutral"}>{label(CONSENT, status)}</Tag>;
}

export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number];

/** Rattachements d'un prospect qui correspondent aux filtres de la liste (campagne, source, étape, intérêt, mes prospects). */
export function membershipFilter(state: ProspectResults, userId: number | undefined) {
  return (p: Prospect): Membership[] =>
    p.campaigns.filter(
      (m) =>
        (!state.campaign || m.campaign_id === Number(state.campaign)) &&
        (!state.sourceFilter || m.source_id === Number(state.sourceFilter)) &&
        (!state.stage || m.conversion_stage === state.stage) &&
        (!state.levelFilter || m.interest_status === state.levelFilter) &&
        (!state.mine || m.assigned_advisor_id === userId),
    );
}
