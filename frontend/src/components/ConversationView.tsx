import { DELIVERY, DRAFT_STATUS, ROLES, formatDate, label } from "@/lib/labels";
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

export default function ConversationView({
  messages,
}: {
  messages: Message[];
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
          <div
            key={m.id}
            className={`bubble ${m.role} ${draft ? `draft draft-${draft.status}` : ""} ${dead ? "dead" : ""}`}
          >
            <div className="bubble-meta">
              {label(ROLES, m.role)} · {formatDate(m.created_at)}
            </div>
            {draft?.status && (
              <div className="bubble-draft">
                {label(DRAFT_STATUS, draft.status)}
                {draft.edited ? " (modifié par un conseiller)" : ""}
                {draft.reason ? ` — motif : ${draft.reason}` : ""}
              </div>
            )}
            <div className="bubble-text">{m.content}</div>
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
            {Array.isArray(sources) && sources.length > 0 && (
              <div className="bubble-meta">Sources : {sources.join(" ; ")}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
