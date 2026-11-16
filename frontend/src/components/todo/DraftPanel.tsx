"use client";

/** Brouillon de l'agent à relire : texte exact qui partira, modification, et décision (valider, régénérer, refuser). */

import { Check, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { Btn, ErrorText, Field, Notice, Tag, TextBox, TextInput, TextLink } from "@/components/ds/controls";
import { Eyebrow } from "@/components/ds/layout";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { api, ApiError } from "@/lib/api";
import { CHANNELS, label } from "@/lib/labels";
import { notifyWorkQueueChanged } from "@/lib/workQueue";
import { Box } from "@/components/ds/card";
import { ShortcutTooltip } from "@/components/ds/shortcut";
import { PanelProps, TODO_KEYS, useReportDirty, itemName } from "@/components/todo/shared";
import { ariaKeyShortcut, type ShortcutKey } from "@/lib/shortcuts";
import { useIsMac } from "@/lib/useIsMac";
import { useShortcuts } from "@/lib/useShortcuts";

export function DraftPanel({
  item,
  onDone,
  onDirtyChange,
  guard,
  conversationLink = true,
  shortcuts = false,
}: PanelProps & {
  /** Faux dans la conversation elle-même : le lien « Voir l'échange complet » y mènerait à la même page. */
  conversationLink?: boolean;
  /** Raccourcis de la file (« À traiter ») : ⌘/Ctrl Entrée valide, M ouvre la modification. */
  shortcuts?: boolean;
}) {
  const user = useCurrentUser();
  const draft = item.draft!;
  const [text, setText] = useState(draft.content);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = user?.role === "VIEWER";
  const base = `/conversations/${item.conversation_id}/drafts/${draft.message_id}`;
  const changed = editing && text !== draft.content;
  useReportDirty(changed, onDirtyChange);
  const mac = useIsMac();
  const canApprove = !readOnly && !busy && !!text.trim();
  const approve = () => act("approve", { content: editing ? text : null });
  const approveLabel = editing ? "Valider la version modifiée" : "Valider la réponse";
  useShortcuts([
    { ...TODO_KEYS.approve, label: approveLabel, run: () => void approve(), disabled: !shortcuts || !canApprove },
    { ...TODO_KEYS.edit, label: "Modifier la réponse", run: () => setEditing(true), disabled: !shortcuts || readOnly || busy || editing },
  ]);
  const keys = (shortcut: ShortcutKey) => (shortcuts ? ariaKeyShortcut(shortcut, mac) : undefined);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/${path}`, { method: "POST", body: body ?? {} });
      notifyWorkQueueChanged();
      const name = itemName(item);
      onDone(
        path === "approve"
          ? { title: "Réponse validée", description: `${name} : son état d’envoi est suivi dans « Traités ».`, treatedId: item.id }
          : path === "reject"
            ? { title: "Brouillon refusé", description: `${name} : aucun envoi n’a été demandé.`, treatedId: item.id }
            : { title: "Nouvelle réponse demandée", description: `${name} : la réponse régénérée reviendra dans la file.` },
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'opération");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box as="section" className="gap-0 overflow-hidden p-0" aria-label="Brouillon de l'agent">
      <header className="flex flex-wrap items-center gap-2 border-b border-separator px-5 py-3.5">
        <strong className="flex-1 type-body font-semibold text-foreground">
          Réponse proposée — {label(CHANNELS, item.channel)}
          {draft.subject ? ` · objet : ${draft.subject}` : ""}
        </strong>
        <Tag tone="warning">À relire avant validation</Tag>
      </header>
      <div className="flex flex-col gap-3 px-5 py-4">
        {editing ? (
          <TextBox
            // Le texte à modifier reçoit le focus (au clic comme avec M).
            autoFocus
            aria-label="Texte du brouillon"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-40"
          />
        ) : (
          <div className="type-body leading-6 whitespace-pre-wrap text-foreground">{text}</div>
        )}
        {draft.footer && (
          <div className="flex flex-col gap-1 rounded-lg bg-surface-secondary px-4 py-3">
            <Eyebrow>Pied de message — ajouté automatiquement, non modifiable</Eyebrow>
            <p className="type-body-sm whitespace-pre-wrap text-muted">{draft.footer}</p>
          </div>
        )}
        <p className="type-caption text-muted">
          C’est le texte exact qui partira
          {draft.footer ? ", pied de message compris" : ""}.
        </p>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
      {readOnly ? (
        <div className="border-t border-separator px-5 py-4">
          <Notice tone="info">Votre accès observateur permet de consulter les brouillons.</Notice>
        </div>
      ) : (
        // Actions sous le texte, sans effet collant : rien ne cache ce qui partira. Mobile : Valider sur toute la
        // largeur, les autres actions en dessous.
        <div className="flex flex-wrap items-center gap-2 border-t border-separator px-5 py-4" aria-label="Décision" role="group">
          <ShortcutTooltip label={approveLabel} shortcut={TODO_KEYS.approve} disabled={!shortcuts}>
            <Btn
              variant="primary"
              className="max-sm:basis-full"
              disabled={!canApprove}
              keyShortcuts={keys(TODO_KEYS.approve)}
              onClick={() => void approve()}
            >
              <Check className="size-4" aria-hidden="true" />
              {busy ? "Traitement en cours…" : approveLabel}
            </Btn>
          </ShortcutTooltip>
          <ShortcutTooltip label="Modifier la réponse" shortcut={TODO_KEYS.edit} disabled={!shortcuts || editing}>
            <Btn
              variant="secondary"
              className="max-sm:flex-1"
              disabled={busy}
              keyShortcuts={editing ? undefined : keys(TODO_KEYS.edit)}
              onClick={() =>
                editing
                  ? guard(() => {
                      setText(draft.content);
                      setEditing(false);
                    })
                  : setEditing(true)
              }
            >
              <Pencil className="size-4" aria-hidden="true" />
              {editing ? "Annuler la modification" : "Modifier"}
            </Btn>
          </ShortcutTooltip>
          <Btn
            variant="secondary"
            className="max-sm:flex-1"
            disabled={busy}
            onClick={() => (changed ? setConfirmRegenerate(true) : void act("regenerate"))}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Régénérer
          </Btn>
          <Btn
            variant="danger-soft"
            className="max-sm:basis-full"
            disabled={busy}
            onClick={() => {
              setReason("");
              setRejecting(true);
            }}
          >
            Refuser le brouillon
          </Btn>
          {conversationLink && (
            <TextLink href={`/conversations?id=${item.conversation_id}`} className="ms-auto px-1 type-body max-sm:ms-0 max-sm:basis-full">
              Voir l’échange complet →
            </TextLink>
          )}
        </div>
      )}
      <p className="border-t border-separator px-5 py-3 type-caption leading-4.5 text-muted">
        Valider approuve le message : il part ensuite par le canal du prospect
        dès que l’envoi est activé (voir Intégrations) et que l’agent n’est pas
        en arrêt d’urgence. Son état reste lisible dans « Traités ».
      </p>
      <ConfirmDialog
        isOpen={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        status="warning"
        title="Régénérer la réponse ?"
        description="Votre version modifiée sera perdue : l’agent propose une nouvelle réponse à la place."
        cancelLabel="Garder ma version"
        confirmLabel="Régénérer"
        onConfirm={() => void act("regenerate")}
      />
      <ConfirmDialog
        isOpen={rejecting}
        onOpenChange={setRejecting}
        title="Refuser le brouillon ?"
        description="Le message ne sera pas envoyé. Le motif est gardé dans la trace de la décision."
        cancelLabel="Annuler"
        confirmLabel="Refuser le brouillon"
        confirmDisabled={reason.trim().length < 3}
        onConfirm={() => void act("reject", { reason: reason.trim() })}
      >
        <Field label="Motif du refus" hint="3 caractères minimum." className="pt-3">
          <TextInput
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. ton trop familier"
          />
        </Field>
      </ConfirmDialog>
    </Box>
  );
}
