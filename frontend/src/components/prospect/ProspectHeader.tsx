"use client";

import { Avatar, Button, buttonVariants, Dropdown, Tooltip } from "@heroui/react";
import { Ellipsis, MessageSquare, Play, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { Btn, LinkButton, Tag } from "@/components/ds/controls";
import { Box } from "@/components/ds/card";
import { Eyebrow } from "@/components/ds/layout";
import { DemoBadge, ScoreBadge, StageBadge } from "@/components/ui";
import { CONSENT, fullName, label } from "@/lib/labels";
import type { Conversation, Prospect } from "@/lib/types";

export type ProspectAction = "opt-out" | "consent" | "erase";

/**
 * En-tête de la fiche : identité, étape et score, puis les actions (règle 22). L'action principale dépend de l'état
 * (« Voir dans la file » si un brouillon attend, sinon « Lancer l'agent ») ; les actions sensibles sont dans
 * « Autres actions ». Une action impossible reste visible, désactivée, avec sa raison en infobulle.
 */
export default function ProspectHeader({
  prospect: p,
  conversation: conv,
  pendingDraftId,
  canWrite,
  isAdmin,
  busy,
  runBlockedReason,
  onRun,
  onAction,
}: {
  prospect: Prospect;
  conversation: Conversation | null;
  pendingDraftId: string | undefined;
  canWrite: boolean;
  isAdmin: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onRun: () => void;
  onAction: (action: ProspectAction) => void;
}) {
  const current = p.campaigns.find((m) => m.id === p.current_membership_id) ?? p.campaigns[0];
  const consentTone = p.consent_status === "granted" ? "success" : p.consent_status === "opted_out" ? "danger" : "neutral";
  const canGrant = p.consent_status !== "opted_out" || isAdmin;
  const actions = [
    canWrite && p.consent_status !== "opted_out" && "opt-out",
    canWrite && p.consent_status !== "granted" && canGrant && "consent",
    isAdmin && "erase",
  ].filter(Boolean) as ProspectAction[];
  const initials =
    [p.first_name, p.last_name]
      .filter(Boolean)
      .map((name) => name![0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <Box as="header" className="flex-row flex-wrap items-start gap-4 p-5">
      <Avatar size="lg" variant="soft" color="accent" aria-hidden="true">
        <Avatar.Fallback>{initials}</Avatar.Fallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Eyebrow>Fiche prospect · #{p.id}</Eyebrow>
        <h1 className="text-[28px]/[34px] font-semibold tracking-[-0.02em] text-foreground">{fullName(p)}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <DemoBadge email={p.email} />
          <Tag tone={consentTone}>{label(CONSENT, p.consent_status)}</Tag>
          {current && (
            <>
              <StageBadge stage={current.conversion_stage} />
              <ScoreBadge total={current.total_score} level={current.interest_status} />
            </>
          )}
          {current?.campaign_name && <Tag>{current.campaign_name}</Tag>}
          {current?.source_name && <Tag>{current.source_name}</Tag>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {pendingDraftId && conv ? (
          <LinkButton variant="primary" href={`/todo?id=${encodeURIComponent(`draft:${conv.id}:${pendingDraftId}`)}`}>
            Voir dans la file
          </LinkButton>
        ) : (
          canWrite &&
          conv &&
          (runBlockedReason ? (
            <Tooltip delay={200}>
              {/* Désactivé mais focalisable (aria-disabled) : la raison reste lisible au survol et au clavier. */}
              <Tooltip.Trigger
                tabIndex={0}
                aria-disabled="true"
                className={buttonVariants({
                  variant: "primary",
                  className: "pointer-events-auto! cursor-not-allowed rounded-lg opacity-60",
                })}
              >
                <Play className="size-4" aria-hidden="true" />
                Lancer l&apos;agent
              </Tooltip.Trigger>
              <Tooltip.Content showArrow className="max-w-64 break-normal">
                <Tooltip.Arrow />
                {runBlockedReason}
              </Tooltip.Content>
            </Tooltip>
          ) : (
            <Btn variant="primary" disabled={busy} onClick={onRun}>
              <Play className="size-4" aria-hidden="true" />
              {busy ? "L'agent réfléchit…" : "Lancer l'agent"}
            </Btn>
          ))
        )}
        {conv && (
          <LinkButton variant="outline" href={`/conversations?id=${encodeURIComponent(conv.id)}`}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Ouvrir dans Conversations
          </LinkButton>
        )}
        {actions.length > 0 && (
          <Dropdown>
            <Button variant="tertiary" isIconOnly aria-label="Autres actions" isDisabled={busy}>
              <Ellipsis className="size-4" aria-hidden="true" />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu aria-label="Autres actions" onAction={(key) => onAction(key as ProspectAction)}>
                {actions.map((action) =>
                  action === "opt-out" ? (
                    <Dropdown.Item key={action} id={action} textValue="Enregistrer une désinscription" variant="danger">
                      <ShieldOff className="size-4" aria-hidden="true" />
                      Enregistrer une désinscription
                    </Dropdown.Item>
                  ) : action === "consent" ? (
                    <Dropdown.Item key={action} id={action} textValue="Consentement">
                      <ShieldCheck className="size-4 text-muted" aria-hidden="true" />
                      {p.consent_status === "opted_out"
                        ? "Lever la désinscription (administrateur)"
                        : "Enregistrer un consentement"}
                    </Dropdown.Item>
                  ) : (
                    <Dropdown.Item key={action} id={action} textValue="Effacer ce prospect" variant="danger">
                      <Trash2 className="size-4" aria-hidden="true" />
                      Effacer ce prospect…
                    </Dropdown.Item>
                  ),
                )}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        )}
      </div>
    </Box>
  );
}
