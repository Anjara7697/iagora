"use client";

/** Contexte d'une conversation, replié par défaut : responsable, campagne, étape, canal de réponse, contraintes et consentement. */

import { Eyebrow } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Collapse } from "@/components/ds/collapse";
import { ScoreBadge, StageBadge } from "@/components/ui";
import { CHANNELS, CONSENT, formatDate, label } from "@/lib/labels";
import type { Conversation, ConversationSummary, Prospect } from "@/lib/types";
import { Box } from "@/components/ds/card";

export function ConversationContext({
  summary,
  conv,
  prospect: p,
}: {
  summary: ConversationSummary;
  conv: Conversation | null | undefined;
  prospect: Prospect | null | undefined;
}) {
  return (
    <Box as="div" className={`gap-0 overflow-hidden p-0 ${reveal(2).className}`} style={reveal(2).style}>
      <Collapse
        title="Contexte et règles d’envoi"
        triggerClassName="w-full px-5 py-3.5 text-sm hover:bg-surface-secondary focus-visible:ring-inset"
      >
        <div className="flex flex-col gap-3 border-t border-separator px-5 py-4 text-sm text-foreground">
          <p>
            Conseiller responsable :{" "}
            {summary.prospect?.assigned_advisor_name ??
              (summary.prospect?.assigned_advisor_id
                ? `Conseiller #${summary.prospect.assigned_advisor_id}`
                : "Non affecté")}
          </p>
          {summary.prospect?.campaign_name ? (
            <p>
              Contexte de l’agent : {summary.prospect.campaign_name}
              {summary.prospect.source_name
                ? ` · ${summary.prospect.source_name}`
                : ""}
            </p>
          ) : (
            <p>À attribuer à une campagne depuis la fiche prospect.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {summary.prospect?.stage && (
              <StageBadge stage={summary.prospect.stage} />
            )}
            {summary.prospect?.total_score != null && (
              <ScoreBadge
                total={summary.prospect.total_score}
                level={summary.prospect.level}
              />
            )}
          </div>
          {conv?.handoff?.pending_question && (
            <div className="flex flex-col gap-1">
              <Eyebrow>Résumé du transfert</Eyebrow>
              <p>{conv.handoff.summary}</p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 rounded-lg bg-surface-secondary p-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Eyebrow>Dernière interaction</Eyebrow>
              <p>
                {formatDate(summary.last_message_at)} ·{" "}
                {label(CHANNELS, summary.channel)}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Eyebrow>Canal de réponse retenu</Eyebrow>
              <p className="break-words">
                {label(CHANNELS, summary.channel)} —{" "}
                {p?.email ?? summary.prospect?.email ?? "-"}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Eyebrow>Contraintes</Eyebrow>
              <p>
                Relances : jours ouvrés, 8 h–19 h (heure de Paris), 3 au plus sans
                réponse · texte seul, pas de pièce jointe
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Eyebrow>Consentement</Eyebrow>
              <p>{p ? label(CONSENT, p.consent_status) : "-"}</p>
            </div>
          </div>
        </div>
      </Collapse>
    </Box>
  );
}
