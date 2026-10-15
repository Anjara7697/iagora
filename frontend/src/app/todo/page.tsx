"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Loading, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError, qs } from "@/lib/api";
import {
  CHANNELS,
  HANDOFF_REASONS,
  PRIORITIES,
  RISKS,
  TODO_KINDS,
  fullName,
  initials,
  label,
  relativeTime,
} from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { TodoItem, TodoKind, TodoPage } from "@/lib/types";

type KindFilter = "" | TodoKind;
const KIND_ORDER: TodoKind[] = [
  "validation",
  "escalation",
  "kb_gap",
  "incident",
];

function itemName(item: TodoItem): string {
  if (item.prospect) return fullName(item.prospect);
  return (
    item.handoff?.identity?.first_name ||
    item.handoff?.identity?.email ||
    "Prospect"
  );
}

function Confidence({ value }: { value: number | null }) {
  if (value === null) return <p className="muted">Non évaluée</p>;
  const percent = Math.round(value * 100);
  return (
    <div className="confidence" aria-label={`Confiance ${percent} %`}>
      <div className="confidence-bar">
        <div style={{ width: `${percent}%` }} />
      </div>
      <span className="mono">{percent} %</span>
    </div>
  );
}

function Row({
  item,
  selected,
  onSelect,
}: {
  item: TodoItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = itemName(item);
  return (
    <li>
      <button
        className={`inbox-row ${selected ? "selected" : ""}`}
        aria-current={selected}
        onClick={onSelect}
      >
        <span className="prospect-avatar" aria-hidden="true">
          {item.kind === "incident" ? "!" : initials(name)}
        </span>
        <span className="inbox-row-main">
          <span className="inbox-row-top">
            <span className="row">
              <span className={`badge kind-${item.kind}`}>
                {label(TODO_KINDS, item.kind)}
              </span>
              <span className={`badge priority-${item.priority}`}>
                {label(PRIORITIES, item.priority)}
              </span>
            </span>
            <span className="mono">{relativeTime(item.created_at)}</span>
          </span>
          <strong>{name}</strong>
          <span className="inbox-preview">
            {item.detail ? `« ${item.detail} »` : item.title}
          </span>
        </span>
      </button>
    </li>
  );
}

function DraftPanel({ item, onDone }: { item: TodoItem; onDone: () => void }) {
  const user = useCurrentUser();
  const draft = item.draft!;
  const [text, setText] = useState(draft.content);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = user?.role === "VIEWER";
  const base = `/conversations/${item.conversation_id}/drafts/${draft.message_id}`;

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/${path}`, { method: "POST", body: body ?? {} });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'opération");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="draft-panel" aria-label="Brouillon de l'agent">
      <header>
        <strong>Brouillon — {label(CHANNELS, item.channel)}</strong>
        <span className="muted">Généré par l&apos;agent</span>
      </header>
      {editing ? (
        <textarea
          aria-label="Texte du brouillon"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <div className="draft-text">{text}</div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {readOnly ? (
        <p className="muted">
          Votre accès observateur permet de consulter les brouillons.
        </p>
      ) : rejecting ? (
        <div className="draft-reject">
          <label>
            Motif du refus
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex. ton trop familier"
            />
          </label>
          <div className="row">
            <button
              className="danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() => act("reject", { reason: reason.trim() })}
            >
              Confirmer le refus
            </button>
            <button disabled={busy} onClick={() => setRejecting(false)}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            className="primary"
            disabled={busy || !text.trim()}
            onClick={() => act("approve", { content: editing ? text : null })}
          >
            {editing ? "Approuver la version modifiée" : "Approuver"}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              editing
                ? (setText(draft.content), setEditing(false))
                : setEditing(true)
            }
          >
            {editing ? "Annuler la modification" : "Modifier"}
          </button>
          <button disabled={busy} onClick={() => act("regenerate")}>
            Régénérer
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Refuser (motif)
          </button>
          <Link
            className="button-link"
            href={`/conversations?id=${item.conversation_id}`}
          >
            Ouvrir la conversation
          </Link>
        </div>
      )}
      <p className="muted">
        Approuver valide le message ; son envoi sur le canal du prospect viendra
        avec les connecteurs (email, Messenger…).
      </p>
    </section>
  );
}

function Detail({ item, onDone }: { item: TodoItem; onDone: () => void }) {
  const name = itemName(item);
  const rec = item.recommendation;
  return (
    <section className="inbox-detail" aria-label={`À traiter : ${name}`}>
      <header className="inbox-detail-head">
        <span className="prospect-avatar inbox-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <div className="inbox-detail-title">
          <h2>{name}</h2>
          <div className="row">
            <span className={`badge kind-${item.kind}`}>
              {label(TODO_KINDS, item.kind)}
            </span>
            <span className={`badge priority-${item.priority}`}>
              {label(PRIORITIES, item.priority)}
            </span>
            {item.prospect?.stage && <StageBadge stage={item.prospect.stage} />}
            {item.prospect?.total_score != null && (
              <ScoreBadge
                total={item.prospect.total_score}
                level={item.prospect.level}
              />
            )}
          </div>
        </div>
        {item.prospect && (
          <Link className="button-link" href={`/prospects/${item.prospect.id}`}>
            Ouvrir la fiche
          </Link>
        )}
      </header>

      <p>
        <strong>{item.title}.</strong> {item.detail && <>« {item.detail} »</>}
      </p>

      {rec && (
        <div className="recommendation">
          <span className="eyebrow">Prochaine action recommandée</span>
          <h3>{rec.action}</h3>
          <div className="recommendation-grid">
            {rec.reason && (
              <div>
                <span className="eyebrow">Pourquoi</span>
                <p>{rec.reason}</p>
              </div>
            )}
            <div>
              <span className="eyebrow">Sources utilisées</span>
              {rec.sources.length > 0 ? (
                <ul>
                  {rec.sources.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  Aucune source de la base de connaissances.
                </p>
              )}
            </div>
            <div>
              <span className="eyebrow">Confiance de l&apos;agent</span>
              <Confidence value={rec.confidence} />
              <span className="eyebrow">Risque</span>
              <p>
                <span className={`badge risk-${rec.risk}`}>
                  {label(RISKS, rec.risk)}
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {item.draft && <DraftPanel key={item.id} item={item} onDone={onDone} />}

      {item.handoff && (
        <div className="card warnbox">
          <strong>Fiche de transfert</strong> —{" "}
          {label(HANDOFF_REASONS, item.handoff.reason)}
          <p>{item.handoff.summary}</p>
          <p>
            <Link href={`/conversations?id=${item.conversation_id}`}>
              Répondre dans la conversation →
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

function Todo() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const [kind, setKind] = useState<KindFilter>("");
  const list = useApi<TodoPage>(`/todo${qs({ kind, limit: 100 })}`);
  const all = useApi<TodoPage>("/todo?limit=1");

  const items = list.data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const counts = all.data?.counts ?? {};
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  const refresh = () => {
    list.reload();
    all.reload();
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Travail · File de validation</span>
          <h1>À traiter</h1>
          <p className="muted">
            Brouillons à valider, escalades, lacunes de la base et incidents.
          </p>
        </div>
      </div>
      <div className="inbox">
        <aside className="inbox-list" aria-label="Éléments à traiter">
          <div className="inbox-filters">
            <div className="chips" role="group" aria-label="Type">
              <button aria-pressed={kind === ""} onClick={() => setKind("")}>
                Tout ({total})
              </button>
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                >
                  {label(TODO_KINDS, k)} ({counts[k] ?? 0})
                </button>
              ))}
            </div>
          </div>
          <Loading loading={list.loading} error={list.error} />
          {list.data && items.length === 0 && (
            <p className="muted inbox-empty">Rien à traiter pour le moment.</p>
          )}
          <ul>
            {items.map((i) => (
              <Row
                key={i.id}
                item={i}
                selected={i.id === selectedId}
                onSelect={() =>
                  router.replace(`/todo?id=${encodeURIComponent(i.id)}`, {
                    scroll: false,
                  })
                }
              />
            ))}
          </ul>
        </aside>
        {selected ? (
          <Detail item={selected} onDone={refresh} />
        ) : (
          <section className="inbox-detail inbox-placeholder">
            <p className="muted">Sélectionnez un élément pour le traiter.</p>
          </section>
        )}
      </div>
    </>
  );
}

export default function TodoPageRoute() {
  return (
    <Suspense fallback={<p className="muted">Chargement…</p>}>
      <Todo />
    </Suspense>
  );
}
