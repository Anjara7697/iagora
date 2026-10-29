import { Sparkles, UserRound } from "lucide-react";
import {
  CHANNELS,
  DELIVERY,
  DRAFT_STATUS,
  formatDate,
  initials,
  label,
} from "@/lib/labels";
import type { Message } from "@/lib/types";

type Draft = { status?: string; reason?: string; edited?: boolean };
type DeliveryInfo = { reason?: string; error?: string; attempts?: number };

// Seuls les messages réellement concernés par un envoi affichent un état (pas les brouillons).
function deliveryLine(
  delivery: unknown,
  info: DeliveryInfo | undefined,
): string | null {
  if (typeof delivery !== "string" || delivery === "draft") return null;
  const base = label(DELIVERY, delivery);
  const detail = info?.reason ?? info?.error;
  return detail ? `${base} — ${detail}` : base;
}

/** Qui parle, et dans quel état : le fil à trois auteurs de la maquette. */
function authorLine(
  m: Message,
  prospectName: string,
  channel: string | undefined,
): string {
  const when = formatDate(m.created_at);
  if (m.role === "prospect")
    return [prospectName, channel ? label(CHANNELS, channel) : null, when]
      .filter(Boolean)
      .join(" · ");
  if (m.role === "advisor") return `Conseiller · ${when}`;
  const draft = m.metadata.draft as Draft | undefined;
  if (draft?.status === "pending")
    return `Agent IA · brouillon du ${when}, en attente de validation`;
  if (draft?.status === "approved")
    return m.metadata.delivery === "sent"
      ? `Agent IA · envoyé après validation · ${when}`
      : `Agent IA · validé par un conseiller · ${when}`;
  if (draft?.status) return `Agent IA · brouillon du ${when}`;
  return m.metadata.delivery === "sent"
    ? `Agent IA · envoyé sans validation · ${when}`
    : `Agent IA · ${when}`;
}

const DELIVERY_TONE: Record<string, string> = {
  sent: "text-success-soft-foreground",
  failed: "text-danger-soft-foreground",
  blocked: "text-danger-soft-foreground",
};

/** Fil de messages : prospect à gauche, agent et conseiller à droite, état d'envoi sous chaque message. */
export default function ConversationView({
  messages,
  prospectName = "Prospect",
  channel,
}: {
  messages: Message[];
  prospectName?: string;
  channel?: string;
}) {
  if (messages.length === 0)
    return (
      <p data-ui="v2" className="text-sm text-muted">
        Aucun message.
      </p>
    );
  return (
    <div data-ui="v2" className="flex flex-col gap-4">
      {messages.map((m) => {
        const sources = m.metadata.sources;
        const draft = m.metadata.draft as Draft | undefined;
        const dead =
          draft?.status === "rejected" ||
          draft?.status === "superseded" ||
          draft?.status === "cancelled";
        const fromProspect = m.role === "prospect";
        const fromAgent = m.role !== "prospect" && m.role !== "advisor";
        const pending = draft?.status === "pending";
        const line = deliveryLine(
          m.metadata.delivery,
          m.metadata.delivery_info as DeliveryInfo | undefined,
        );
        return (
          <article
            key={m.id}
            className={`flex gap-2.5 ${fromProspect ? "flex-row" : "flex-row-reverse"} ${dead ? "opacity-60" : ""}`}
          >
            <span
              className={`mt-5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                fromProspect
                  ? "bg-surface-tertiary text-foreground"
                  : fromAgent
                    ? "bg-agent-soft text-agent"
                    : "bg-accent-soft text-accent-soft-foreground"
              }`}
              aria-hidden="true"
            >
              {fromProspect ? initials(prospectName) : fromAgent ? <Sparkles className="size-3.5" /> : <UserRound className="size-3.5" />}
            </span>
            <div className={`flex max-w-[min(640px,85%)] min-w-0 flex-col gap-1 ${fromProspect ? "items-start" : "items-end"}`}>
              <div className="text-xs text-muted">{authorLine(m, prospectName, channel)}</div>
              <div
                className={`flex flex-col gap-2 rounded-2xl px-4 py-3 text-sm ${
                  fromProspect
                    ? "rounded-tl-md bg-surface text-foreground shadow-surface"
                    : fromAgent
                      ? `rounded-tr-md ${pending ? "border border-dashed border-agent/50 bg-agent-soft/60" : "bg-agent-soft"} text-foreground`
                      : "rounded-tr-md bg-accent-soft text-foreground"
                }`}
              >
                {pending && (
                  <div className="text-xs font-medium text-agent-soft-foreground">
                    Brouillon · pas encore validé
                  </div>
                )}
                {draft?.status && !pending && (
                  <div className="text-xs font-medium text-muted">
                    {label(DRAFT_STATUS, draft.status)}
                    {draft.edited ? " (modifié par un conseiller)" : ""}
                    {draft.reason ? ` — motif : ${draft.reason}` : ""}
                  </div>
                )}
                <div className={`whitespace-pre-wrap ${dead ? "line-through decoration-muted/60" : ""}`}>{m.content}</div>
                {Array.isArray(sources) && sources.length > 0 && (
                  <div className="text-xs text-muted">Sources : {sources.join(" ; ")}</div>
                )}
              </div>
              {fromProspect && <div className="text-xs text-muted">Reçu</div>}
              {line && (
                <div className={`text-xs ${DELIVERY_TONE[String(m.metadata.delivery)] ?? "text-muted"}`}>{line}</div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
