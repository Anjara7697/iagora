"use client";

import { Avatar } from "@heroui/react";
import { ArrowRight, ChevronLeft, ChevronRight, Inbox as InboxIcon, MessageSquareQuote, PenLine, Send, Settings2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import ConversationView from "@/components/ConversationView";
import { useReplyDraft } from "@/components/ReplyDrafts";
import { notifyWorkQueueChanged } from "@/lib/workQueue";
import {
  Btn,
  ErrorText,
  FilterChip,
  LinkButton,
  NativeSelect,
  Segmented,
  Tag,
  TextBox,
  TextInput,
  TextLink,
} from "@/components/ds/controls";
import { EmptyPanel, Eyebrow, Screen } from "@/components/ds/layout";
import { DemoBadge, Loading, ScoreBadge, StageBadge, Skeleton } from "@/components/ui";
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
  { value: "handed_off", text: "En attente" },
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

function rowName(c: ConversationSummary): string {
  if (c.prospect) return fullName(c.prospect);
  return (
    c.handoff?.identity?.first_name ||
    c.handoff?.identity?.email ||
    `Prospect ${c.prospect_id}`
  );
}

const STATUS_TONE = { open: "accent", handed_off: "warning", closed: "neutral" } as const;

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
        className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus ${
          selected ? "bg-accent-soft" : "hover:bg-surface-secondary"
        }`}
        aria-current={selected}
        onClick={onSelect}
      >
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
  const conversation = useApi<Conversation>(`/conversations/${summary.id}`, {
    keepPrevious: true,
  });
  const prospect = useApi<Prospect>(`/prospects/${summary.prospect_id}`);
  const [text, setText] = useReplyDraft(summary.id);
  const [pending, setPending] = useState<"send" | "status" | "agent" | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Le message de confirmation s'efface seul : il ne doit pas rester en place
  // comme un état de la conversation.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const conv = conversation.data;
  const p = prospect.data;
  const readOnly = user?.role === "VIEWER";
  const pendingDraft = conv?.messages.some(
    (m) =>
      (m.metadata.draft as { status?: string } | undefined)?.status ===
      "pending",
  );
  const optedOut = p?.consent_status === "opted_out";
  const syncing = conversation.loading || prospect.loading;
  const name = rowName(summary);

  async function act(
    kind: "send" | "status" | "agent",
    action: () => Promise<unknown>,
    message: string,
  ) {
    setPending(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      notifyWorkQueueChanged();
      conversation.reload();
      prospect.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'opération");
    } finally {
      setPending(null);
    }
  }

  const setStatus = (status: "open" | "handed_off" | "closed") =>
    act("status", () =>
      api(`/conversations/${summary.id}`, {
        method: "PATCH",
        body: { status },
      }),
      status === "closed"
        ? "Conversation clôturée."
        : status === "handed_off"
          ? "La conversation est maintenant confiée au conseiller."
          : "Conversation rouverte pour l’agent.",
    );
  const runAgent = () =>
    act("agent", () =>
      api("/agent/runs", {
        method: "POST",
        body: { conversation_id: summary.id },
      }),
      "Traitement de l’agent enregistré. Consultez le fil pour retrouver le résultat.",
    );
  const send = () =>
    act("send", async () => {
      const submitted = text;
      await api(`/conversations/${summary.id}/messages`, {
        method: "POST",
        body: { role: "advisor", content: submitted.trim() },
      });
      // Une réponse HTTP tardive ne doit pas effacer une nouvelle saisie.
      setText((current) => current === submitted ? "" : current);
    }, "Réponse enregistrée. Consultez son état d’envoi dans le fil.");

  const pendingId = conv?.messages.find(
    (m) => (m.metadata.draft as { status?: string } | undefined)?.status === "pending",
  )?.id;

  return (
    <section
      className="flex min-w-0 flex-1 flex-col gap-4"
      aria-label={`Conversation avec ${name}`}
    >
      <header className="flex flex-wrap items-start gap-3">
        <Avatar size="md" variant="soft" color="accent" aria-hidden="true">
          <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-xl font-semibold tracking-[-0.01em] text-foreground">{name}</h2>
          <div className="flex flex-wrap gap-1.5">
            <Tag tone={STATUS_TONE[summary.status as keyof typeof STATUS_TONE] ?? "neutral"}>
              {label(CONVERSATION_STATUS, summary.status)}
            </Tag>
            <Tag>{label(CHANNELS, summary.channel)}</Tag>
          </div>
        </div>
        <LinkButton size="sm" variant="outline" href={`/prospects/${summary.prospect_id}`}>
          Ouvrir la fiche
        </LinkButton>
      </header>

      <Loading
        loading={conversation.loading}
        error={conversation.error}
        onRetry={conversation.reload}
      />
      <Loading
        loading={prospect.loading}
        error={prospect.error}
        onRetry={prospect.reload}
      />
      {optedOut && (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-soft-foreground" role="status">
          Ce prospect s&apos;est désinscrit : aucun message ne peut lui être
          envoyé.
        </p>
      )}
      {conv?.handoff && (
        <section className="flex flex-col gap-3 rounded-xl bg-warning-soft px-5 py-4" aria-label="Fiche de transfert">
          <div className="flex flex-wrap items-center gap-2">
            <MessageSquareQuote className="size-4 text-warning-soft-foreground" aria-hidden="true" />
            <h3 className="flex-1 text-sm font-semibold text-foreground">Fiche de transfert</h3>
            <Tag tone="warning">{label(HANDOFF_REASONS, conv.handoff.reason)}</Tag>
          </div>
          {conv.handoff.pending_question ? (
            <blockquote className="flex flex-col gap-1 rounded-xl bg-surface/70 px-4 py-3">
              <Eyebrow>Question à reprendre</Eyebrow>
              <p className="text-sm text-foreground">« {conv.handoff.pending_question} »</p>
            </blockquote>
          ) : <p className="text-sm text-foreground">{conv.handoff.summary}</p>}
          <p className="text-sm text-foreground">
            <b className="font-semibold">Action recommandée :</b> {conv.handoff.recommended_action}
          </p>
          {!readOnly && !optedOut && conv.status !== "closed" && (
            <div>
              <Btn size="sm" variant="primary" disabled={busy || syncing || !p} onClick={() => {
                replyRef.current?.focus({ preventScroll: true });
                replyRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
              }}>
                <PenLine className="size-4" aria-hidden="true" />
                Rédiger une réponse
              </Btn>
            </div>
          )}
        </section>
      )}
      <details className="card card--default group gap-0 p-0">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-5 py-3.5 text-sm font-medium text-foreground outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
          Contexte et règles d’envoi
        </summary>
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
          <div className="grid grid-cols-1 gap-4 rounded-xl bg-surface-secondary p-4 sm:grid-cols-2">
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
      </details>
      {pendingDraft && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-agent-soft px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Eyebrow className="text-agent-soft-foreground">À vous de décider</Eyebrow>
            <h3 className="text-sm font-semibold text-foreground">Une réponse est prête à être relue.</h3>
            <p className="text-sm text-foreground/85">
              Un brouillon de l&apos;agent attend votre validation :{" "}
              <TextLink href={`/todo?id=${encodeURIComponent(`draft:${summary.id}:${pendingId}`)}`}>
                le traiter dans « À traiter »
              </TextLink>
              .
            </p>
          </div>
          <Tag tone="warning">Validation requise</Tag>
        </div>
      )}
      {conv && (
        <section className="card card--default gap-4 p-5" aria-label="Fil de la conversation">
          <div className="flex items-baseline gap-2">
            <h3 className="flex-1 text-base font-semibold text-foreground">Fil de la conversation</h3>
            <span className="text-xs text-muted">
              {conv.messages.length} message{conv.messages.length > 1 ? "s" : ""}
            </span>
          </div>
          <ConversationView
            messages={conv.messages}
            prospectName={name}
            channel={conv.channel}
          />
        </section>
      )}

      {readOnly && (
        <p className="text-[13px] text-muted">
          Votre accès observateur permet de consulter les échanges.
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {notice && (
        <p className="rounded-xl bg-success-soft px-4 py-3 text-sm text-success-soft-foreground" role="status" aria-label="Résultat de l’action">
          {notice}
        </p>
      )}

      {!readOnly && conv && conv.status === "closed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-secondary px-5 py-3">
          <p className="flex-1 text-sm text-muted">Cette conversation est clôturée.</p>
          <Btn disabled={busy || syncing || optedOut} onClick={() => setStatus("open")}>
            Rouvrir la conversation
          </Btn>
        </div>
      )}
      {!readOnly && conv && conv.status !== "closed" && (
        <div className="card card--default gap-3 p-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong className="text-sm font-semibold text-foreground">Votre réponse</strong>
            <span className="text-xs text-muted">
              {label(CHANNELS, summary.channel)} ·{" "}
              {p?.email ?? summary.prospect?.email ?? "Prospect"}
            </span>
          </div>
          <TextBox
            aria-label="Votre réponse"
            placeholder="Écrire une réponse…"
            value={text}
            ref={replyRef}
            disabled={busy || optedOut || !p || syncing}
            onChange={(e) => setText(e.target.value)}
            className="min-h-32"
          />
          {text.trim() && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              Réponse non envoyée · conservée pendant votre navigation.
              <Btn size="sm" variant="ghost" disabled={busy} onClick={() => {
                if (window.confirm("Effacer cette réponse non envoyée ?")) setText("");
              }}>Effacer la réponse</Btn>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Btn
              variant="primary"
              disabled={busy || syncing || !p || optedOut || !text.trim()}
              onClick={send}
            >
              <Send className="size-4" aria-hidden="true" />
              {pending === "send" ? "Enregistrement…" : `Envoyer en tant que ${user?.username}`}
            </Btn>
            <p className="min-w-0 flex-1 text-xs text-muted">
              {summary.channel === "email"
                ? "Envoyé par email dès que l’envoi est actif ; son état s’affiche sous le message dans le fil."
                : "Message enregistré ; la livraison sur ce canal reste à confirmer."}
            </p>
          </div>

          <details className="group border-t border-separator pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
              <Settings2 className="size-4 text-muted" aria-hidden="true" />
              Gestion de la conversation
              <ChevronRight className="size-3.5 text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
            </summary>
            <div className="flex flex-wrap gap-2 pt-3">
              {conv.status === "open" ? (
                <>
                  <Btn size="sm" disabled={busy || syncing} onClick={() => setStatus("handed_off")}>
                    Prendre la main
                  </Btn>
                  <Btn
                    size="sm"
                    disabled={busy || syncing || !p || optedOut || pendingDraft}
                    onClick={runAgent}
                  >
                    {pending === "agent" ? "L'agent réfléchit…" : "Relancer l'agent"}
                  </Btn>
                </>
              ) : (
                <Btn size="sm" disabled={busy || syncing} onClick={() => setStatus("open")}>
                  Rendre la main à l&apos;agent
                </Btn>
              )}
              <Btn
                size="sm"
                variant="danger-soft"
                disabled={busy || syncing}
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
              </Btn>
            </div>
          </details>
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
  const inPage = items.find((c) => c.id === selectedId) ?? null;
  const direct = useApi<ConversationSummary>(
    selectedId
      ? `/conversations/${encodeURIComponent(selectedId)}/summary`
      : null,
    { keepPrevious: true },
  );
  const selected =
    inPage ?? (direct.data?.id === selectedId ? direct.data : null);
  const select = (id: string) =>
    router.replace(`/conversations?id=${id}`, { scroll: false });
  const reset = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  return (
    <Screen wide className="gap-4">
      <div className="sr-only">
        <span>Travail · Boîte de réception</span>
        <h1>Conversations</h1>
        <p>Tous les échanges des prospects avec l&apos;agent, au même endroit.</p>
      </div>
      {selectedId && (
        <div className="lg:hidden">
          <Btn
            variant="ghost"
            onClick={() => router.replace("/conversations", { scroll: false })}
          >
            ← Liste des conversations
          </Btn>
        </div>
      )}
      <div className="flex items-start gap-6">
        <aside
          className={`card card--default w-full shrink-0 gap-3 p-3 lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-7.5rem)] lg:w-[380px] lg:overflow-y-auto ${selectedId ? "hidden" : "flex"}`}
          aria-label="Liste des conversations"
        >
          <div className="flex flex-col gap-2.5 px-1 pt-1">
            <TextInput
              type="search"
              aria-label="Rechercher une conversation"
              placeholder="Nom ou email…"
              value={q}
              onChange={(e) => reset(() => setQ(e.target.value))}
            />
            <Segmented
              label="Statut"
              className="w-full"
              value={status}
              options={STATUS_FILTERS}
              onChange={(v) => reset(() => setStatus(v))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Responsable" className="flex flex-wrap gap-1.5">
                {OWNER_FILTERS.map((o) => (
                  <FilterChip key={o.value} pressed={owner === o.value} onClick={() => reset(() => setOwner(o.value))}>
                    {o.text}
                  </FilterChip>
                ))}
              </div>
              <NativeSelect
                aria-label="Canal"
                className="min-w-[150px] flex-1"
                value={channel}
                onChange={(e) => reset(() => setChannel(e.target.value))}
              >
                {CHANNEL_FILTERS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.text}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <Loading
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            shape="rows"
          />
          {list.data && items.length === 0 && (
            <p className="px-2 py-3 text-[13px] text-muted">
              Aucune conversation ne correspond à ces filtres.
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
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
            <div className="flex items-center justify-between gap-2 border-t border-separator px-1 pt-3">
              <Btn
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label="Conversations précédentes"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                <ChevronLeft className="size-4" />
              </Btn>
              <span className="text-xs text-muted tabular-nums">
                {offset + 1}-{Math.min(offset + LIMIT, list.data.total)} sur{" "}
                {list.data.total}
              </span>
              <Btn
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label="Conversations suivantes"
                disabled={offset + LIMIT >= list.data.total}
                onClick={() => setOffset(offset + LIMIT)}
              >
                <ChevronRight className="size-4" />
              </Btn>
            </div>
          )}
        </aside>
        <div className={`min-w-0 flex-1 ${selectedId ? "flex" : "hidden lg:flex"}`}>
          {selected ? (
            <Detail
              key={selected.id}
              summary={selected}
              onChanged={() => {
                list.reload();
                direct.reload();
              }}
            />
          ) : selectedId ? (
            <section className="card card--default flex-1 p-6">
              <Loading
                loading={direct.loading}
                error={direct.error}
                onRetry={direct.reload}
              />
            </section>
          ) : (
            <section className="card card--default flex-1 p-0">
              <EmptyPanel
                icon={InboxIcon}
                title="Choisissez une conversation"
                description="Sélectionnez une conversation pour lire l'échange et y répondre."
                action={
                  <LinkButton variant="outline" href="/todo">
                    Voir ce qui est à traiter
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </LinkButton>
                }
              />
            </section>
          )}
        </div>
      </div>
    </Screen>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={<Skeleton shape="rows" />}>
      <Inbox />
    </Suspense>
  );
}
