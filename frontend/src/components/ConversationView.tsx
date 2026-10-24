import {
  CHANNELS,
  DELIVERY,
  DRAFT_STATUS,
  formatDate,
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

export default function ConversationView({
  messages,
  prospectName = "Prospect",
  channel,
}: {
  messages: Message[];
  prospectName?: string;
  channel?: string;
}) {
  if (messages.length === 0) return <p className="muted">Aucun message.</p>;
  return (
    <div className="chat">
      {messages.map((m) => {
        const sources = m.metadata.sources;
        const draft = m.metadata.draft as Draft | undefined;
        const dead =
          draft?.status === "rejected" ||
          draft?.status === "superseded" ||
          draft?.status === "cancelled";
        return (
          <article
            key={m.id}
            className={`message message-${m.role} ${draft?.status === "pending" ? "message-pending" : ""} ${dead ? "dead" : ""}`}
          >
            <div className="bubble-meta">
              <span
                className={`author-dot author-${m.role}`}
                aria-hidden="true"
              />
              {authorLine(m, prospectName, channel)}
            </div>
            <div
              className={`bubble ${m.role} ${draft ? `draft draft-${draft.status}` : ""}`}
            >
              {draft?.status === "pending" && (
                <div className="pending-message-label">
                  Brouillon · pas encore validé
                </div>
              )}
              {draft?.status && draft.status !== "pending" && (
                <div className="bubble-draft">
                  {label(DRAFT_STATUS, draft.status)}
                  {draft.edited ? " (modifié par un conseiller)" : ""}
                  {draft.reason ? ` — motif : ${draft.reason}` : ""}
                </div>
              )}
              <div className="bubble-text">{m.content}</div>
              {Array.isArray(sources) && sources.length > 0 && (
                <div className="bubble-sources">
                  Sources : {sources.join(" ; ")}
                </div>
              )}
            </div>
            {m.role === "prospect" && (
              <div className="bubble-delivery">Reçu</div>
            )}
            {(() => {
              const line = deliveryLine(
                m.metadata.delivery,
                m.metadata.delivery_info as DeliveryInfo | undefined,
              );
              return line ? (
                <div
                  className={`bubble-delivery delivery-${m.metadata.delivery}`}
                >
                  {line}
                </div>
              ) : null;
            })()}
          </article>
        );
      })}
    </div>
  );
}
