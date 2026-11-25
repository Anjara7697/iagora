"use client";

/**
 * « Ajouter à la base » (D-50) : sur une question transmise faute de document, le conseiller propose la réponse
 * (question reformulée, réponse, programme) ; un administrateur la valide avant qu'elle rejoigne la FAQ « Questions
 * des prospects » du programme. Un administrateur qui l'ajoute lui-même la valide du même geste.
 */

import { toast } from "@heroui/react";
import { BookPlus, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Box } from "@/components/ds/card";
import { Btn, ErrorText, Field, SelectInput, TextBox, TextInput, TextLink } from "@/components/ds/controls";
import { reveal } from "@/components/ds/motion";
import { api, ApiError } from "@/lib/api";
import { TARGETS, formatDate } from "@/lib/labels";
import { useCurrentUser } from "@/lib/session";
import type { KbSuggestion, KbSuggestionPrefill } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export const QUESTION_MAX = 200;
export const ANSWER_MAX = 2000;
const COMMON = "";

export const PROGRAMME_OPTIONS = [
  { value: COMMON, label: "Tous les programmes" },
  ...Object.entries(TARGETS).map(([value, label]) => ({ value, label })),
];

/** Nom de la FAQ où la réponse est (ou sera) rangée. */
export function faqName(target: string | null | undefined) {
  return target ? `Questions des prospects — ${TARGETS[target] ?? target}` : "Questions des prospects (commun)";
}

/** Champs communs à la proposition et à la relecture. */
export function SuggestionFields({
  question,
  answer,
  target,
  onChange,
  disabled,
}: {
  question: string;
  answer: string;
  target: string;
  onChange: (patch: Partial<{ question: string; answer: string; target: string }>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Question" hint="Formulée de façon générale, sans nom ni information personnelle du prospect.">
        <TextInput
          value={question}
          maxLength={QUESTION_MAX}
          disabled={disabled}
          onChange={(e) => onChange({ question: e.target.value })}
        />
      </Field>
      <Field
        label="Réponse"
        hint={`Ce que l’agent pourra dire à tous les prospects, seulement des informations vérifiées. ${answer.length}/${ANSWER_MAX}`}
      >
        <TextBox
          rows={5}
          value={answer}
          maxLength={ANSWER_MAX}
          disabled={disabled}
          onChange={(e) => onChange({ answer: e.target.value })}
        />
      </Field>
      <SelectInput
        label="Programme concerné"
        value={target}
        options={PROGRAMME_OPTIONS}
        disabled={disabled}
        onChange={(value) => onChange({ target: value })}
      />
    </div>
  );
}

export function suggestionReady(question: string, answer: string) {
  return question.trim().length >= 5 && answer.trim().length >= 5 && answer.length <= ANSWER_MAX;
}

function Status({ suggestion }: { suggestion: KbSuggestion }) {
  if (suggestion.status === "approved") {
    return (
      <div className="flex items-start gap-2 type-body text-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <span>
          Ajoutée à la base le {formatDate(suggestion.decided_at)} dans{" "}
          {suggestion.document_slug ? (
            <TextLink href={`/knowledge?doc=${suggestion.document_slug}`}>{faqName(suggestion.target_code)}</TextLink>
          ) : (
            faqName(suggestion.target_code)
          )}
          . L’agent répond désormais à cette question.
        </span>
      </div>
    );
  }
  if (suggestion.status === "rejected") {
    return (
      <div className="flex items-start gap-2 type-body text-foreground">
        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <span>
          Proposition refusée{suggestion.decided_by ? ` par ${suggestion.decided_by}` : ""}
          {suggestion.reason ? ` : « ${suggestion.reason} »` : "."} Vous pouvez en proposer une nouvelle.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 type-body text-foreground">
      <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <span>
        Réponse proposée{suggestion.proposed_by ? ` par ${suggestion.proposed_by}` : ""} le{" "}
        {formatDate(suggestion.created_at)} : elle attend la validation d’un administrateur.{" "}
        <TextLink href="/knowledge?tab=suggestions">Voir les propositions</TextLink>
      </span>
    </div>
  );
}

export function AddToKnowledge({ conversationId, index = 3 }: { conversationId: string; index?: number }) {
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const readOnly = user?.role === "VIEWER";
  const prefill = useApi<KbSuggestionPrefill>(`/knowledge/suggestions/prefill?conversation_id=${encodeURIComponent(conversationId)}`);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ question: "", answer: "", target: COMMON });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<KbSuggestion | null>(null);

  useEffect(() => {
    if (!prefill.data) return;
    setLatest(prefill.data.existing ?? null);
    setForm({ question: prefill.data.question, answer: prefill.data.answer, target: prefill.data.target_code ?? COMMON });
  }, [prefill.data]);

  if (prefill.error || !prefill.data) return null;
  const blocked = latest && latest.status !== "rejected";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let saved = await api<KbSuggestion>("/knowledge/suggestions", {
        method: "POST",
        body: { conversation_id: conversationId, question: form.question, answer: form.answer, target_code: form.target || null },
      });
      if (isAdmin) {
        saved = await api<KbSuggestion>(`/knowledge/suggestions/${saved.id}/approve`, { method: "POST", body: {} });
        toast.success("Réponse ajoutée à la base", { description: faqName(saved.target_code) });
      } else {
        toast.success("Réponse proposée", { description: "Un administrateur la relira avant de l’ajouter à la base." });
      }
      setLatest(saved);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi impossible. Réessayez.");
      // Un administrateur dont la validation échoue garde sa proposition en attente : on la montre.
      prefill.reload();
    } finally {
      setBusy(false);
    }
  };

  const motion = reveal(index);
  return (
    <Box as="section" aria-label="Apprendre de cette question" className={`gap-3 p-5 ${motion.className}`} style={motion.style}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-agent-soft text-agent" aria-hidden="true">
          <BookPlus className="size-4" />
        </span>
        <div className="flex min-w-[200px] flex-1 flex-col">
          <h3 className="type-body font-semibold text-foreground">Apprendre de cette question</h3>
          <p className="type-body-sm text-muted">
            Ajoutez la réponse à la base : l’agent saura répondre la prochaine fois, sans transfert.
          </p>
        </div>
        {!readOnly && !open && !blocked && (
          <Btn variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <BookPlus className="size-4" aria-hidden="true" />
            Ajouter à la base
          </Btn>
        )}
      </div>
      {latest && !open && <Status suggestion={latest} />}
      {open && (
        <form
          className="flex flex-col gap-4 border-t border-separator pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (suggestionReady(form.question, form.answer)) void submit();
          }}
        >
          <SuggestionFields
            question={form.question}
            answer={form.answer}
            target={form.target}
            disabled={busy}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto type-caption text-muted">
              {isAdmin
                ? `Ajoutée directement à « ${faqName(form.target)} ».`
                : "Un administrateur la relira avant qu’elle entre dans la base."}
            </span>
            <Btn variant="tertiary" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Annuler
            </Btn>
            <Btn variant="primary" size="sm" type="submit" disabled={busy || !suggestionReady(form.question, form.answer)}>
              {busy ? "Envoi…" : isAdmin ? "Ajouter à la base" : "Proposer la réponse"}
            </Btn>
          </div>
        </form>
      )}
    </Box>
  );
}
