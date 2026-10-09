import { ROLES, formatDate, label } from "@/lib/labels";
import type { Message } from "@/lib/types";

export default function ConversationView({ messages }: { messages: Message[] }) {
  if (messages.length === 0) return <p className="muted">Aucun message.</p>;
  return (
    <div className="chat">
      {messages.map((m) => {
        const sources = m.metadata.sources;
        return (
          <div key={m.id} className={`bubble ${m.role}`}>
            <div className="bubble-meta">
              {label(ROLES, m.role)} · {formatDate(m.created_at)}
            </div>
            <div className="bubble-text">{m.content}</div>
            {Array.isArray(sources) && sources.length > 0 && (
              <div className="bubble-meta">Sources : {sources.join(" ; ")}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
