"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import ConversationView from "@/components/ConversationView";
import { DemoBadge, Loading, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError, qs } from "@/lib/api";
import {
  CHANNELS,
  CONVERSATION_STATUS,
  CONSENT,
  HANDOFF_REASONS,
  formatDate,
  fullName,
  initials,
  label,
  relativeTime,
} from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type {
  Conversation,
  ConversationSummary,
  Page,
  Prospect,
} from "@/lib/types";

const LIMIT = 30;
type StatusFilter = "" | "handed_off" | "open" | "closed";
type OwnerFilter = "" | "me" | "none";

const STATUS_FILTERS: { value: StatusFilter; text: string }[] = [
  { value: "", text: "Toutes" },
  { value: "handed_off", text: "En attente de vous" },
  { value: "open", text: "Ouvertes" },
  { value: "closed", text: "Clôturées" },
];
const OWNER_FILTERS: { value: OwnerFilter; text: string }[] = [
  { value: "", text: "Tous" },
  { value: "me", text: "Moi" },
  { value: "none", text: "Non assigné" },
];
const CHANNEL_FILTERS = [
  { value: "", text: "Tous les canaux" },
  ...Object.entries(CHANNELS).map(([value, text]) => ({ value, text })),
];

function Chips<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; text: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="chips" role="group" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

function rowName(c: ConversationSummary): string {
  if (c.prospect) return fullName(c.prospect);
  return (
    c.handoff?.identity?.first_name ||
    c.handoff?.identity?.email ||
    `Prospect ${c.prospect_id}`
  );
}

function InboxRow({
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
      <button
        className={`inbox-row ${selected ? "selected" : ""}`}
        aria-current={selected}
        onClick={onSelect}
      >
        <span className="prospect-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="inbox-row-main">
          <span className="inbox-row-top">
            <strong>{name}</strong>
            <DemoBadge email={c.prospect?.email} />
            <span className="mono">{relativeTime(c.last_message_at)}</span>
          </span>
          <span className="row">
            <span className="badge">{label(CHANNELS, c.channel)}</span>
            {c.status === "handed_off" && (
              <span className="badge warn">
                {c.handoff
                  ? label(HANDOFF_REASONS, c.handoff.reason)
                  : "Transfert"}
              </span>
            )}
            {c.status === "closed" && <span className="badge">Clôturée</span>}
          </span>
          <span className="inbox-preview">
            {c.last_message_preview
              ? `« ${c.last_message_preview} »`
              : "Aucun message."}
          </span>
        </span>
      </button>
    </li>
  );
}

function Detail({
  summary,
  onChanged,
}: {
  summary: ConversationSummary;
  onChanged: () => void;
}) {
  const user = useCurrentUser();
  const conversation = useApi<Conversation>(`/conversations/${summary.id}`);
  const prospect = useApi<Prospect>(`/prospects/${summary.prospect_id}`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conv = conversation.data;
  const p = prospect.data;
  const readOnly = user?.role === "VIEWER";
  const pendingDraft = conv?.messages.some(
    (m) =>
      (m.metadata.draft as { status?: string } | undefined)?.status ===
      "pending",
  );
  const optedOut = p?.consent_status === "opted_out";
  const name = rowName(summary);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      conversation.reload();
      prospect.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'opération");
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (status: "open" | "handed_off" | "closed") =>
    act(() =>
      api(`/conversations/${summary.id}`, {
        method: "PATCH",
        body: { status },
      }),
    );
  const runAgent = () =>
    act(() =>
      api("/agent/runs", {
        method: "POST",
        body: { conversation_id: summary.id },
      }),
    );
  const send = () =>
    act(async () => {
      await api(`/conversations/${summary.id}/messages`, {
        method: "POST",
        body: { role: "advisor", content: text.trim() },
      });
      setText("");
    });

  return (
    <section className="inbox-detail" aria-label={`Conversation avec ${name}`}>
      <header className="inbox-detail-head">
        <span className="prospect-avatar inbox-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <div className="inbox-detail-title">
          <h2>{name}</h2>
          <div className="row">
            {summary.prospect?.stage && (
              <StageBadge stage={summary.prospect.stage} />
            )}
            {summary.prospect?.total_score != null && (
              <ScoreBadge
                total={summary.prospect.total_score}
                level={summary.prospect.level}
              />
            )}
            <span className={`badge conv-${summary.status}`}>
              {label(CONVERSATION_STATUS, summary.status)}
            </span>
            <span className="badge">{label(CHANNELS, summary.channel)}</span>
          </div>
        </div>
        <Link
          className="button-link"
          href={`/prospects/${summary.prospect_id}`}
        >
          Ouvrir la fiche
        </Link>
      </header>

      <div className="inbox-info">
        <div>
          <span className="eyebrow">Dernière interaction</span>
          <p>
            {formatDate(summary.last_message_at)} ·{" "}
            {label(CHANNELS, summary.channel)}
          </p>
        </div>
        <div>
          <span className="eyebrow">Canal de réponse retenu</span>
          <p>
            {label(CHANNELS, summary.channel)} —{" "}
            {p?.email ?? summary.prospect?.email ?? "-"}
          </p>
        </div>
        <div>
          <span className="eyebrow">Contraintes</span>
          <p>
            Relances : jours ouvrés, 8 h–19 h (heure de Paris), 3 au plus sans
            réponse · texte seul, pas de pièce jointe
          </p>
        </div>
        <div>
          <span className="eyebrow">Consentement</span>
          <p>{p ? label(CONSENT, p.consent_status) : "-"}</p>
        </div>
      </div>

      <Loading
        loading={conversation.loading}
        error={conversation.error}
        onRetry={conversation.reload}
      />
      {conv?.handoff && (
        <div className="card warnbox">
          <strong>Fiche de transfert</strong> —{" "}
          {label(HANDOFF_REASONS, conv.handoff.reason)}
          {conv.handoff.pending_question && (
            <p>Question : « {conv.handoff.pending_question} »</p>
          )}
          <p>{conv.handoff.summary}</p>
          <p>
            <b>Action recommandée :</b> {conv.handoff.recommended_action}
          </p>
        </div>
      )}
      {conv && (
        <ConversationView
          messages={conv.messages}
          prospectName={name}
          channel={conv.channel}
        />
      )}

      {pendingDraft && (
        <p className="warnbox card">
          Un brouillon de l&apos;agent attend votre validation :{" "}
          <Link
            href={`/todo?id=${encodeURIComponent(`draft:${summary.id}:${conv?.messages.find((m) => (m.metadata.draft as { status?: string } | undefined)?.status === "pending")?.id}`)}`}
          >
            le traiter dans « À traiter »
          </Link>
          .
        </p>
      )}
      {readOnly && (
        <p className="muted">
          Votre accès observateur permet de consulter les échanges.
        </p>
      )}
      {optedOut && (
        <p className="muted">
          Ce prospect s&apos;est désinscrit : aucun message ne peut lui être
          envoyé.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!readOnly && conv && conv.status === "closed" && (
        <div className="row">
          <p className="muted">Cette conversation est clôturée.</p>
          <button disabled={busy || optedOut} onClick={() => setStatus("open")}>
            Rouvrir la conversation
          </button>
        </div>
      )}
      {!readOnly && conv && conv.status !== "closed" && (
        <div className="inbox-composer">
          <textarea
            aria-label="Votre réponse"
            placeholder="Écrire une réponse…"
            value={text}
            disabled={busy || optedOut}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row">
            <button
              className="primary"
              disabled={busy || optedOut || !text.trim()}
              onClick={send}
            >
              Envoyer en tant que {user?.username}
            </button>
            {conv.status === "open" ? (
              <>
                <button disabled={busy} onClick={() => setStatus("handed_off")}>
                  Prendre la main
                </button>
                <button
                  disabled={busy || optedOut || pendingDraft}
                  onClick={runAgent}
                >
                  {busy ? "L'agent réfléchit…" : "Relancer l'agent"}
                </button>
              </>
            ) : (
              <button disabled={busy} onClick={() => setStatus("open")}>
                Rendre la main à l&apos;agent
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Clôturer la conversation ? Les relances et les brouillons en attente seront annulés.",
                  )
                )
                  void setStatus("closed");
              }}
            >
              Clôturer
            </button>
          </div>
          <p className="muted">
            Le message est enregistré dans la conversation. Son envoi sur le
            canal du prospect viendra avec les connecteurs (email, Messenger…).
          </p>
        </div>
      )}
    </section>
  );
}

function Inbox() {
  const user = useCurrentUser();
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const [status, setStatus] = useState<StatusFilter>(
    (["open", "handed_off", "closed"].includes(params.get("status") ?? "")
      ? params.get("status")
      : "") as StatusFilter,
  );
  const [owner, setOwner] = useState<OwnerFilter>("");
  const [channel, setChannel] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  const list = useApi<Page<ConversationSummary>>(
    `/conversations${qs({
      status,
      channel,
      q,
      advisor_id: owner === "me" ? user?.id : undefined,
      unassigned: owner === "none" ? "true" : undefined,
      limit: LIMIT,
      offset,
    })}`,
    { keepPrevious: true },
  );

  const items = list.data?.items ?? [];
  const selected = items.find((c) => c.id === selectedId) ?? null;
  const select = (id: string) =>
    router.replace(`/conversations?id=${id}`, { scroll: false });
  const reset = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Travail · Boîte de réception</span>
          <h1>Conversations</h1>
          <p className="muted">
            Tous les échanges des prospects avec l&apos;agent, au même endroit.
          </p>
        </div>
      </div>
      <div className="inbox">
        <aside className="inbox-list" aria-label="Liste des conversations">
          <div className="inbox-filters">
            <input
              type="search"
              aria-label="Rechercher une conversation"
              placeholder="Nom ou email…"
              value={q}
              onChange={(e) => reset(() => setQ(e.target.value))}
            />
            <Chips
              name="Statut"
              value={status}
              options={STATUS_FILTERS}
              onChange={(v) => reset(() => setStatus(v))}
            />
            <Chips
              name="Responsable"
              value={owner}
              options={OWNER_FILTERS}
              onChange={(v) => reset(() => setOwner(v))}
            />
            <select
              aria-label="Canal"
              value={channel}
              onChange={(e) => reset(() => setChannel(e.target.value))}
            >
              {CHANNEL_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
            </select>
          </div>
          <Loading
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
          />
          {list.data && items.length === 0 && (
            <p className="muted inbox-empty">
              Aucune conversation ne correspond à ces filtres.
            </p>
          )}
          <ul>
            {items.map((c) => (
              <InboxRow
                key={c.id}
                c={c}
                selected={c.id === selectedId}
                onSelect={() => select(c.id)}
              />
            ))}
          </ul>
          {list.data && list.data.total > LIMIT && (
            <div className="pager">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                ←
              </button>
              <span className="muted">
                {offset + 1}-{Math.min(offset + LIMIT, list.data.total)} sur{" "}
                {list.data.total}
              </span>
              <button
                disabled={offset + LIMIT >= list.data.total}
                onClick={() => setOffset(offset + LIMIT)}
              >
                →
              </button>
            </div>
          )}
        </aside>
        {selected ? (
          <Detail
            key={selected.id}
            summary={selected}
            onChanged={list.reload}
          />
        ) : (
          <section className="inbox-detail inbox-placeholder">
            <p className="muted">
              Sélectionnez une conversation pour lire l&apos;échange et y
              répondre.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={<p className="muted">Chargement…</p>}>
      <Inbox />
    </Suspense>
  );
}
