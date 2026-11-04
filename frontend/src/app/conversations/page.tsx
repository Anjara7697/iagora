"use client";

import { Avatar, Button, Dropdown, toast } from "@heroui/react";
import { ArrowRight, Bot, Ellipsis, Hand, Inbox as InboxIcon, MessageSquareQuote, PenLine, RotateCcw, Send, Archive, UserRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useRef, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import ConversationView from "@/components/ConversationView";
import { useReplyDraft } from "@/components/ReplyDrafts";
import { notifyWorkQueueChanged } from "@/lib/workQueue";
import {
  Btn,
  ErrorText,
  FilterChipGroup,
  LinkButton,
  SelectBox,
  Tag,
  TextBox,
  TextInput,
  RowButton,
} from "@/components/ds/controls";
import { EmptyPanel, Eyebrow, PageHeader, Screen } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { TablePagination } from "@/components/ds/table";
import { Collapse } from "@/components/ds/collapse";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { DraftPanel } from "@/components/todo/DraftPanel";
import type { DecisionResult } from "@/components/todo/shared";
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
import {
  OWNER_FILTERS,
  STATUS_FILTERS,
  conversationHref,
  isFiltered,
  readConversationView,
  type ConversationView as InboxView,
} from "@/lib/conversationNav";
import { replaceUrl } from "@/lib/url";
import type {
  Conversation,
  ConversationSummary,
  Page,
  Prospect,
  TodoItem,
} from "@/lib/types";
import { Box } from "@/components/ds/card";

/** Conversations par page de la liste. */
const LIMIT = 30;
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

/** Changements d'état qui demandent confirmation : leur effet est dit avant d'agir. */
type Confirmable = "give_back" | "agent" | "close" | "clear";
const CONFIRM: Record<Confirmable, { title: string; description: string; confirmLabel: string; cancelLabel?: string; status: "accent" | "danger" }> = {
  give_back: {
    title: "Rendre la main à l’agent ?",
    description:
      "L’agent reprend cette conversation : il pourra de nouveau préparer les réponses et les relances, selon son mode (avec ou sans votre validation).",
    confirmLabel: "Rendre la main",
    status: "accent",
  },
  agent: {
    title: "Relancer l’agent ?",
    description:
      "L’agent relit la conversation et prépare une nouvelle réponse. Selon son mode, elle attendra votre validation ou partira directement.",
    confirmLabel: "Relancer l’agent",
    status: "accent",
  },
  close: {
    title: "Clôturer la conversation ?",
    description: "Les relances et les brouillons en attente seront annulés. Vous pourrez la rouvrir ensuite.",
    confirmLabel: "Clôturer",
    status: "danger",
  },
  clear: {
    title: "Effacer la réponse ?",
    description: "Le texte non envoyé sera perdu.",
    confirmLabel: "Effacer",
    cancelLabel: "Garder la réponse",
    status: "danger",
  },
};

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
      <RowButton selected={selected} onClick={onSelect}>
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
      </RowButton>
    </li>
  );
}

function Detail({
  summary,
  onChanged,
  onDirtyChange,
  guard,
}: {
  summary: ConversationSummary;
  onChanged: () => void;
  /** Brouillon de l'agent modifié et non validé : la page protège alors le changement de conversation. */
  onDirtyChange: (dirty: boolean) => void;
  guard: (action: () => void) => void;
}) {
  const user = useCurrentUser();
  const router = useRouter();
  const conversation = useApi<Conversation>(`/conversations/${summary.id}`, {
    keepPrevious: true,
  });
  const prospect = useApi<Prospect>(`/prospects/${summary.prospect_id}`);
  const [text, setText] = useReplyDraft(summary.id);
  const [pending, setPending] = useState<"send" | "status" | "agent" | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirmable | null>(null);
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

  // Chaque action réussie est confirmée par un Toast ; un échec reste affiché près de l'action (ErrorText).
  async function act(
    kind: "send" | "status" | "agent",
    action: () => Promise<unknown>,
    result: { title: string; description: string },
  ) {
    setPending(kind);
    setError(null);
    try {
      await action();
      toast.success(result.title, { description: result.description });
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
        ? { title: "Conversation clôturée", description: `${name} : relances et brouillons en attente annulés.` }
        : status === "handed_off"
          ? { title: "Conversation confiée au conseiller", description: `${name} : vous avez la main sur les réponses.` }
          : { title: "Conversation rouverte pour l’agent", description: `${name} : l’agent peut de nouveau préparer les réponses.` },
    );
  const runAgent = () =>
    act("agent", () =>
      api("/agent/runs", {
        method: "POST",
        body: { conversation_id: summary.id },
      }),
      { title: "Agent relancé", description: "Son traitement est enregistré : retrouvez le résultat dans le fil." },
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
    }, { title: "Réponse enregistrée", description: "Son état d’envoi s’affiche sous le message dans le fil." });

  const pendingId = conv?.messages.find(
    (m) => (m.metadata.draft as { status?: string } | undefined)?.status === "pending",
  )?.id;
  // Le brouillon en attente se décide ici, avec le panneau d'« À traiter » (même API, mêmes confirmations).
  // Un brouillon décidé ici disparaît aussitôt, sans attendre le rechargement du fil ; un nouveau brouillon
  // (après « Régénérer ») a un autre identifiant et s'affiche de nouveau.
  const [decided, setDecided] = useState<string | null>(null);
  const draftId = pendingId && `draft:${summary.id}:${pendingId}` !== decided ? `draft:${summary.id}:${pendingId}` : null;
  const draftItem = useApi<TodoItem>(draftId ? `/todo/item${qs({ id: draftId })}` : null);
  function onDraftDone(result: DecisionResult) {
    const treatedId = result.treatedId;
    toast.success(result.title, {
      description: result.description,
      actionProps: treatedId
        ? {
            children: "Voir la décision",
            onPress: () => router.push(`/todo${qs({ tab: "treated", id: treatedId })}`),
          }
        : undefined,
    });
    onDirtyChange(false);
    setDecided(draftId);
    conversation.reload();
    onChanged();
  }

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
            {/* Statut de la conversation chargée (celui sur lequel portent les actions), sinon celui de la liste. */}
            <Tag tone={STATUS_TONE[(conv?.status ?? summary.status) as keyof typeof STATUS_TONE] ?? "neutral"}>
              {label(CONVERSATION_STATUS, conv?.status ?? summary.status)}
            </Tag>
            <Tag>{label(CHANNELS, summary.channel)}</Tag>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:basis-full">
          {/* Actions sur l'état de la conversation, près de son statut : l'action principale selon l'état, les
              autres dans « … ». Rendre la main, relancer l'agent et clôturer demandent confirmation. */}
          {!readOnly && conv && conv.status === "open" && (
            <Btn size="sm" variant="secondary" disabled={busy || syncing} onClick={() => void setStatus("handed_off")}>
              <Hand className="size-4" aria-hidden="true" />
              Prendre la main
            </Btn>
          )}
          {!readOnly && conv && conv.status === "handed_off" && (
            <Btn size="sm" variant="secondary" disabled={busy || syncing} onClick={() => setConfirm("give_back")}>
              <Bot className="size-4" aria-hidden="true" />
              Rendre la main à l&apos;agent
            </Btn>
          )}
          {!readOnly && conv && conv.status === "closed" && (
            <Btn size="sm" variant="secondary" disabled={busy || syncing || optedOut} onClick={() => void setStatus("open")}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Rouvrir la conversation
            </Btn>
          )}
          {/* Sur mobile, l'icône seule (le nom accessible reste « Ouvrir la fiche ») : les actions tiennent sur une ligne. */}
          <LinkButton size="sm" variant="outline" href={`/prospects/${summary.prospect_id}`} aria-label="Ouvrir la fiche">
            <UserRound className="size-4 sm:hidden" aria-hidden="true" />
            <span className="max-sm:hidden">Ouvrir la fiche</span>
          </LinkButton>
          {!readOnly && conv && conv.status !== "closed" && (
            <Dropdown>
              <Button size="sm" variant="tertiary" isIconOnly aria-label="Autres actions" isDisabled={busy || syncing}>
                <Ellipsis className="size-4" aria-hidden="true" />
              </Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  aria-label="Autres actions"
                  disabledKeys={conv.status !== "open" || !p || optedOut || pendingDraft ? ["agent"] : []}
                  onAction={(key) => setConfirm(key === "agent" ? "agent" : "close")}
                >
                  <Dropdown.Item id="agent" textValue="Relancer l’agent">
                    <Bot className="size-4 text-muted" aria-hidden="true" />
                    {pending === "agent" ? "L’agent réfléchit…" : "Relancer l’agent"}
                  </Dropdown.Item>
                  <Dropdown.Item id="close" textValue="Clôturer" variant="danger">
                    <Archive className="size-4" aria-hidden="true" />
                    Clôturer
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          )}
        </div>
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
      <Collapse
  title="Contexte et règles d’envoi"
  className="card card--default gap-0 p-0"
  triggerClassName="w-full rounded-xl px-5 py-3.5 text-sm hover:bg-surface-secondary"
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
</Collapse>
      {conv && (
        <Box as="section" className="gap-4 p-5" aria-label="Fil de la conversation">
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
        </Box>
      )}
      {pendingDraft && draftId && (
        <>
          <Loading loading={draftItem.loading && !draftItem.data} error={draftItem.error} onRetry={draftItem.reload} />
          {draftItem.data?.id === draftId && draftItem.data.draft && (
            <DraftPanel
              key={draftId}
              item={draftItem.data}
              conversationLink={false}
              onDone={onDraftDone}
              onDirtyChange={onDirtyChange}
              guard={guard}
            />
          )}
        </>
      )}

      {readOnly && (
        <p className="text-[13px] text-muted">
          Votre accès observateur permet de consulter les échanges.
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}

      {!readOnly && conv && conv.status === "closed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-secondary px-5 py-3">
          <p className="flex-1 text-sm text-muted">
            Cette conversation est clôturée. « Rouvrir la conversation », en haut, permet d’y répondre de nouveau.
          </p>
        </div>
      )}
      {!readOnly && conv && conv.status !== "closed" && (
        <Box as="div" className="gap-3 p-5">
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
              <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("clear")}>
                Effacer la réponse
              </Btn>
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

        </Box>
      )}
      {confirm && (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setConfirm(null);
          }}
          {...CONFIRM[confirm]}
          onConfirm={() => {
            if (confirm === "give_back") void setStatus("open");
            else if (confirm === "close") void setStatus("closed");
            else if (confirm === "agent") void runAgent();
            else setText("");
          }}
        />
      )}
    </section>
  );
}

function Inbox() {
  const user = useCurrentUser();
  // État de la liste dans l'adresse (règle 6) : recherche, filtres, page et conversation ouverte.
  const view = readConversationView(useSearchParams());
  const selectedId = view.id;

  // Brouillon de l'agent modifié dans le détail : changer de conversation demande confirmation.
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const { guard, dialog: discardDialog } = useDiscardGuard(() => dirty.current);
  const navigate = (patch: Partial<InboxView>) =>
    replaceUrl(conversationHref({ ...readConversationView(new URLSearchParams(window.location.search)), ...patch }));
  // Changer de filtre revient à la page 1 ; la conversation ouverte reste affichée.
  const filter = (patch: Partial<InboxView>) => navigate({ ...patch, page: 1 });
  const select = (id: string | null) => {
    if (id === selectedId) return;
    guard(() => {
      dirty.current = false;
      navigate({ id });
    });
  };

  const offset = (view.page - 1) * LIMIT;
  const list = useApi<Page<ConversationSummary>>(
    `/conversations${qs({
      status: view.status,
      channel: view.channel,
      q: view.q,
      advisor_id: view.owner === "me" ? user?.id : undefined,
      unassigned: view.owner === "none" ? "true" : undefined,
      limit: LIMIT,
      offset,
    })}`,
    { keepPrevious: true },
  );
  const filtered = isFiltered(view);
  // Total sans filtre, pour « N sur M » (règle 5).
  const all = useApi<Page<ConversationSummary>>(filtered ? "/conversations?limit=1" : null);

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const inPage = items.find((c) => c.id === selectedId) ?? null;
  const direct = useApi<ConversationSummary>(
    selectedId
      ? `/conversations/${encodeURIComponent(selectedId)}/summary`
      : null,
    { keepPrevious: true },
  );
  const selected =
    inPage ?? (direct.data?.id === selectedId ? direct.data : null);
  const header = reveal(0);
  const queue = reveal(1);

  return (
    <Screen wide className="gap-4">
      <PageHeader
        eyebrow="Travail · Boîte de réception"
        title="Conversations"
        subtitle={
          // Sur mobile, une conversation ouverte prend la place.
          <span className={selectedId ? "max-lg:hidden" : undefined}>
            Tous les échanges des prospects avec l’agent et les conseillers, au même endroit.
          </span>
        }
        className={header.className}
        style={header.style}
      />
      {selectedId && (
        <div className="lg:hidden">
          <Btn variant="ghost" onClick={() => select(null)}>
            ← Liste des conversations
          </Btn>
        </div>
      )}
      <div className="flex items-start gap-5">
        {/* File posée sur la page (règle 20) : titre et compteur, recherche et filtres, liste sur sa surface,
            pagination. */}
        <aside
          aria-label="Liste des conversations"
          style={queue.style}
          className={`w-full shrink-0 flex-col gap-3 lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-6rem)] lg:w-[360px] lg:overflow-y-auto lg:pb-2 ${selectedId ? "hidden" : "flex"} ${queue.className}`}
        >
          <header className="flex items-baseline gap-2">
            <h2 className="flex-1 text-base font-semibold text-foreground">Boîte de réception</h2>
            <span className="text-[13px] text-muted tabular-nums" role="status">
              {list.data
                ? `${total} conversation${total > 1 ? "s" : ""}${filtered && all.data ? ` sur ${all.data.total}` : ""}`
                : ""}
            </span>
          </header>
          <TextInput
            variant="secondary"
            type="search"
            aria-label="Rechercher une conversation"
            placeholder="Nom ou email…"
            value={view.q}
            onChange={(e) => filter({ q: e.target.value })}
          />
          <FilterChipGroup
            label="Statut"
            options={[...STATUS_FILTERS]}
            value={view.status}
            onChange={(status) => filter({ status })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <FilterChipGroup
              label="Responsable"
              options={[...OWNER_FILTERS]}
              value={view.owner}
              onChange={(owner) => filter({ owner })}
            />
            <SelectBox
              variant="secondary"
              aria-label="Canal"
              className="min-w-[150px] flex-1"
              value={view.channel}
              onChange={(e) => filter({ channel: e.target.value })}
            >
              {CHANNEL_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
            </SelectBox>
          </div>
          <Loading
            loading={list.loading && !list.data}
            error={list.error}
            onRetry={list.reload}
            shape="rows"
          />
          {list.data && items.length === 0 && (
            <div className="flex flex-col items-start gap-2 px-2 py-3">
              <p className="text-[13px] text-muted">
                {filtered ? "Aucune conversation ne correspond à ces filtres." : "Aucune conversation pour le moment."}
              </p>
              {filtered && (
                <Btn size="sm" variant="secondary" onClick={() => filter({ q: "", status: "", owner: "", channel: "" })}>
                  Afficher tout
                </Btn>
              )}
            </div>
          )}
          {items.length > 0 && (
            <Box as="ul" className="gap-0.5 p-1.5">
              {items.map((c) => (
                <InboxRow
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onSelect={() => select(c.id)}
                />
              ))}
            </Box>
          )}
          {list.data && (total > LIMIT || view.page > 1) && (
            <TablePagination
              className="flex-wrap justify-center gap-2"
              total={total}
              pageSize={LIMIT}
              page={view.page}
              onChange={(page) => navigate({ page })}
            />
          )}
        </aside>
        <div className={`min-w-0 flex-1 ${selectedId ? "flex" : "hidden lg:flex"}`}>
          {selected ? (
            <Detail
              key={selected.id}
              summary={selected}
              onDirtyChange={onDirtyChange}
              guard={guard}
              onChanged={() => {
                list.reload();
                direct.reload();
                all.reload();
              }}
            />
          ) : selectedId ? (
            <Box as="section" className="flex-1 p-6">
              <Loading
                loading={direct.loading}
                error={direct.error}
                onRetry={direct.reload}
              />
            </Box>
          ) : (
            <Box as="section" className="flex-1 p-0">
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
            </Box>
          )}
        </div>
      </div>
      {discardDialog}
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
