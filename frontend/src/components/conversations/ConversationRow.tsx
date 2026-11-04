"use client";

/** Ligne de la liste des conversations : prospect, canal, transfert ou clôture, dernier message. */

import { Avatar } from "@heroui/react";
import { Tag, RowButton } from "@/components/ds/controls";
import { DemoBadge } from "@/components/ui";
import { CHANNELS, HANDOFF_REASONS, initials, label, relativeTime } from "@/lib/labels";
import type { ConversationSummary } from "@/lib/types";
import { rowName } from "@/components/conversations/shared";

export function ConversationRow({
  c,
  selected,
  onSelect,
}: {
  c: ConversationSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = rowName(c);
  return (
    <li>
      <RowButton selected={selected} onClick={onSelect}>
        <Avatar size="sm" variant="soft" color="accent" aria-hidden="true">
          <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <strong className="min-w-0 truncate text-sm font-semibold text-foreground">{name}</strong>
            <DemoBadge email={c.prospect?.email} />
            <span className="ms-auto shrink-0 text-xs text-muted">{relativeTime(c.last_message_at)}</span>
          </span>
          <span className="flex flex-wrap gap-1.5">
            <Tag>{label(CHANNELS, c.channel)}</Tag>
            {c.status === "handed_off" && (
              <Tag tone="warning">
                {c.handoff
                  ? label(HANDOFF_REASONS, c.handoff.reason)
                  : "Transfert"}
              </Tag>
            )}
            {c.status === "closed" && <Tag tone="muted">Clôturée</Tag>}
          </span>
          <span className="line-clamp-2 text-[13px]/[18px] text-foreground/80">
            {c.last_message_preview
              ? `« ${c.last_message_preview} »`
              : "Aucun message."}
          </span>
        </span>
      </RowButton>
    </li>
  );
}
