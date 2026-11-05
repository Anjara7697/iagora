/** Libellés et petits utilitaires partagés par l'écran Conversations. */

import { CHANNELS, fullName } from "@/lib/labels";
import type { ConversationSummary } from "@/lib/types";

export const CHANNEL_FILTERS = [
  { value: "", text: "Tous les canaux" },
  ...Object.entries(CHANNELS).map(([value, text]) => ({ value, text })),
];

export function rowName(c: ConversationSummary): string {
  if (c.prospect) return fullName(c.prospect);
  return (
    c.handoff?.identity?.first_name ||
    c.handoff?.identity?.email ||
    `Prospect ${c.prospect_id}`
  );
}

export const STATUS_TONE = { open: "accent", handed_off: "warning", closed: "neutral" } as const;
