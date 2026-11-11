"use client";

import { Alert } from "@heroui/react";
import { MessageSquare } from "lucide-react";
import ConversationView from "@/components/ConversationView";
import InteractionHistory from "@/components/InteractionHistory";
import { Notice, Tag } from "@/components/ds/controls";
import { EmptyPanel, Panel } from "@/components/ds/layout";
import { Loading } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { CHANNELS, CONVERSATION_STATUS, HANDOFF_REASONS, fullName, label } from "@/lib/labels";
import type { Conversation, Prospect } from "@/lib/types";

/** Onglet « Conversation » : fil de l'échange (lecture), fiche de transfert éventuelle, puis historique des échanges. */
export default function ProspectConversation({
  prospect: p,
  conversation: conv,
  loading,
  error,
  onRetry,
  readOnly,
  revision,
}: {
  prospect: Prospect;
  conversation: Conversation | null;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  readOnly: boolean;
  revision: number;
}) {
  const missing = error?.status === 404;
  return (
    <div className="flex flex-col gap-6">
      <Panel
        label="Conversation du prospect"
        title="Conversation"
        action={
          conv && (
            <div className="flex flex-wrap gap-1.5">
              <Tag>{label(CHANNELS, conv.channel)}</Tag>
              <Tag tone={conv.status === "handed_off" ? "warning" : conv.status === "open" ? "accent" : "neutral"}>
                {label(CONVERSATION_STATUS, conv.status)}
              </Tag>
            </div>
          )
        }
        bodyClassName="gap-4 px-5 py-4"
      >
        <Loading loading={loading} error={missing ? null : error} onRetry={onRetry} />
        {missing && <EmptyPanel icon={MessageSquare} title="Aucune conversation" />}
        {readOnly && (
          <p className="text-[13px] text-muted">
            Votre accès observateur permet de consulter les échanges et les décisions.
          </p>
        )}
        {conv?.handoff && (
          <Notice tone="warning" aria-label="Fiche de transfert">
            <Alert.Title>Fiche de transfert — {label(HANDOFF_REASONS, conv.handoff.reason)}</Alert.Title>
            <div className="flex flex-col gap-1 pt-1 text-sm text-foreground">
              {conv.handoff.pending_question && <p>Question : « {conv.handoff.pending_question} »</p>}
              <p>
                <b className="font-semibold">Action recommandée :</b> {conv.handoff.recommended_action}
              </p>
            </div>
          </Notice>
        )}
        {conv && <ConversationView messages={conv.messages} prospectName={fullName(p)} channel={conv.channel} />}
      </Panel>
      <InteractionHistory key={`${p.id}:${revision}`} id={p.id} />
    </div>
  );
}
