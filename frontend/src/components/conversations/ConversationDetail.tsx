"use client";

/**
 * Détail d'une conversation : en-tête avec les actions sur son état (confirmées quand elles ont un effet), alertes
 * durables, contexte, fil, brouillon de l'agent à décider sur place et réponse du conseiller.
 */

import { Alert, Avatar, Button, Dropdown, toast } from "@heroui/react";
import { Bot, Ellipsis, Hand, PenLine, RotateCcw, Send, Archive, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { displayNameOf } from "@/components/shell/AccountMenu";
import ConversationView from "@/components/ConversationView";
import { useReplyDraft } from "@/components/ReplyDrafts";
import { notifyWorkQueueChanged } from "@/lib/workQueue";
import { Btn, ErrorText, LinkButton, Notice, Tag, TextBox } from "@/components/ds/controls";
import { Eyebrow } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { DraftPanel } from "@/components/todo/DraftPanel";
import type { DecisionResult } from "@/components/todo/shared";
import { Loading } from "@/components/ui";
import { api, ApiError, qs } from "@/lib/api";
import { CHANNELS, CONVERSATION_STATUS, HANDOFF_REASONS, initials, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Conversation, ConversationSummary, Prospect, TodoItem } from "@/lib/types";
import { Box } from "@/components/ds/card";
import { rowName, STATUS_TONE } from "@/components/conversations/shared";
import { ConversationContext } from "@/components/conversations/ConversationContext";

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


export function ConversationDetail({
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
      <header className={`flex flex-wrap items-start gap-3 ${reveal(0).className}`} style={reveal(0).style}>
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
        <Alert status="danger" role="status" {...reveal(1)}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Ce prospect s&apos;est désinscrit : aucun message ne peut lui être envoyé.</Alert.Title>
          </Alert.Content>
        </Alert>
      )}
      {conv?.handoff && (
        // État durable (règle 13) : Alert HeroUI avec l'action qui le résout (« Rédiger une réponse »).
        <section aria-label="Fiche de transfert" {...reveal(1)}>
          <Notice tone="warning">
            <Alert.Title className="flex flex-wrap items-center gap-2">
              <span className="shrink-0">Fiche de transfert</span>
              <Tag tone="warning">{label(HANDOFF_REASONS, conv.handoff.reason)}</Tag>
            </Alert.Title>
            <div className="flex flex-col gap-3 pt-1 text-sm text-foreground">
              {conv.handoff.pending_question ? (
                <blockquote className="flex flex-col gap-1 rounded-lg bg-surface-secondary px-4 py-3">
                  <Eyebrow>Question à reprendre</Eyebrow>
                  <p>« {conv.handoff.pending_question} »</p>
                </blockquote>
              ) : (
                <p>{conv.handoff.summary}</p>
              )}
              <p>
                <b className="font-semibold">Action recommandée :</b> {conv.handoff.recommended_action}
              </p>
              {!readOnly && !optedOut && conv.status !== "closed" && (
                <div>
                  <Btn
                    size="sm"
                    variant="primary"
                    disabled={busy || syncing || !p}
                    onClick={() => {
                      replyRef.current?.focus({ preventScroll: true });
                      replyRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
                    }}
                  >
                    <PenLine className="size-4" aria-hidden="true" />
                    Rédiger une réponse
                  </Btn>
                </div>
              )}
            </div>
          </Notice>
        </section>
      )}
      <ConversationContext summary={summary} conv={conv} prospect={p} />
      {conv && (
        <Box as="section" className={`gap-4 p-5 ${reveal(3).className}`} style={reveal(3).style} aria-label="Fil de la conversation">
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
            <div {...reveal(4)}>
              <DraftPanel
                key={draftId}
                item={draftItem.data}
                conversationLink={false}
                onDone={onDraftDone}
                onDirtyChange={onDirtyChange}
                guard={guard}
              />
            </div>
          )}
        </>
      )}

      {readOnly && <Notice tone="info">Votre accès observateur permet de consulter les échanges.</Notice>}
      {error && <ErrorText>{error}</ErrorText>}

      {!readOnly && conv && conv.status === "closed" && (
        <Notice tone="info" {...reveal(5)}>
          Cette conversation est clôturée : relances et brouillons annulés. « Rouvrir la conversation », en haut, permet d’y répondre de nouveau.
        </Notice>
      )}
      {!readOnly && conv && conv.status !== "closed" && (
        <Box as="div" className={`gap-3 p-5 ${reveal(5).className}`} style={reveal(5).style}>
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
              {pending === "send" ? "Enregistrement…" : `Envoyer en tant que ${user ? displayNameOf(user.username) : "conseiller"}`}
            </Btn>
            {/* Sur mobile, l'aide passe sous le bouton au lieu d'une colonne étroite à côté. */}
            <p className="min-w-0 flex-1 text-xs text-muted max-sm:basis-full">
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
