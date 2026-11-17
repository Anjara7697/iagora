import { Tag, type Tone } from "@/components/ds/controls";
import { CAMPAIGN_STATUS, label } from "@/lib/labels";

const STATUS_TONE: Record<string, Tone> = { active: "success", draft: "warning", inactive: "neutral" };

/** Statut d'une campagne (liste et fiche) : active en vert, brouillon en orange, en pause en neutre. */
export function CampaignStatusTag({ status }: { status: string }) {
  return <Tag tone={STATUS_TONE[status] ?? "neutral"}>{label(CAMPAIGN_STATUS, status)}</Tag>;
}
