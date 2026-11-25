"use client";

/**
 * Propositions de réponses (D-50) : les réponses écrites par les conseillers après une question sans réponse
 * attendent ici la validation d'un administrateur, qui peut les corriger, les ranger dans un autre programme ou les
 * refuser. Les autres rôles voient la file sans pouvoir décider.
 */

import { toast } from "@heroui/react";
import { BookPlus, Check, X } from "lucide-react";
import { useState } from "react";
import { Box } from "@/components/ds/card";
import { Btn, ErrorText, Field, Tag, TextInput, TextLink } from "@/components/ds/controls";
import { EmptyPanel, ErrorState } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Skeleton } from "@/components/ds/ui";
import { SuggestionFields, faqName, suggestionReady } from "@/components/knowledge/AddToKnowledge";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { KbSuggestion, KbSuggestionPage } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function SuggestionCard({
  suggestion,
  isAdmin,
  configured,
  index,
  onDone,
}: {
  suggestion: KbSuggestion;
  isAdmin: boolean;
  configured: boolean;
  index: number;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    question: suggestion.question,
    answer: suggestion.answer,
    target: suggestion.target_code ?? "",
  });
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (path: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      const body =
        path === "approve"
          ? { question: form.question, answer: form.answer, target_code: form.target || null }
          : { reason: reason.trim() || null };
      const done = await api<KbSuggestion>(`/knowledge/suggestions/${suggestion.id}/${path}`, { method: "POST", body });
      if (path === "approve") toast.success("Réponse ajoutée à la base", { description: faqName(done.target_code) });
      else toast.success("Proposition refusée", { description: "Rien n’a été ajouté à la base." });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action impossible. Réessayez.");
      if (err instanceof ApiError && err.status === 409) onDone();
    } finally {
      setBusy(false);
    }
  };

  const motion = reveal(index);
  return (
    <Box as="article" aria-label={`Proposition : ${suggestion.question}`} className={`gap-4 p-5 ${motion.className}`} style={motion.style}>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="warning">À valider</Tag>
        <span className="type-caption text-muted">
          Proposée{suggestion.proposed_by ? ` par ${suggestion.proposed_by}` : ""} le {formatDate(suggestion.created_at)}
        </span>
        {suggestion.conversation_id && (
          <TextLink className="ml-auto type-caption" href={`/conversations?id=${suggestion.conversation_id}`}>
            Voir la conversation
          </TextLink>
        )}
      </div>
      {suggestion.prospect_question && (
        <div className="flex flex-col gap-1">
          <span className="type-caption text-muted">Question posée par le prospect</span>
          <blockquote className="rounded-lg border-l-2 border-border bg-surface-secondary px-4 py-3 type-body whitespace-pre-wrap text-foreground">
            « {suggestion.prospect_question} »
          </blockquote>
        </div>
      )}
      {isAdmin ? (
        <SuggestionFields
          question={form.question}
          answer={form.answer}
          target={form.target}
          disabled={busy}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />
      ) : (
        <dl className="flex flex-col gap-2 type-body">
          <dt className="type-caption text-muted">Question</dt>
          <dd className="font-medium text-foreground">{suggestion.question}</dd>
          <dt className="type-caption text-muted">Réponse</dt>
          <dd className="whitespace-pre-wrap text-foreground">{suggestion.answer}</dd>
          <dt className="type-caption text-muted">Rangée dans</dt>
          <dd className="text-foreground">{faqName(suggestion.target_code)}</dd>
        </dl>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {isAdmin && refusing && (
        <Field label="Motif du refus (facultatif)" hint="Visible par le conseiller qui a proposé la réponse.">
          <TextInput value={reason} maxLength={300} disabled={busy} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      {isAdmin && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {refusing ? (
            <>
              <Btn variant="tertiary" size="sm" disabled={busy} onClick={() => setRefusing(false)}>
                Annuler
              </Btn>
              <Btn variant="danger" size="sm" disabled={busy} onClick={() => void decide("reject")}>
                Refuser la proposition
              </Btn>
            </>
          ) : (
            <>
              {!configured && (
                <span className="mr-auto type-caption text-warning-soft-foreground">
                  Service de recherche non configuré : validation impossible pour l’instant.
                </span>
              )}
              <Btn variant="tertiary" size="sm" disabled={busy} onClick={() => setRefusing(true)}>
                <X className="size-4" aria-hidden="true" />
                Refuser
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                disabled={busy || !configured || !suggestionReady(form.question, form.answer)}
                onClick={() => void decide("approve")}
              >
                <Check className="size-4" aria-hidden="true" />
                {busy ? "Ajout…" : "Valider et ajouter"}
              </Btn>
            </>
          )}
        </div>
      )}
    </Box>
  );
}

export default function SuggestionList({
  isAdmin,
  configured,
  onChanged,
}: {
  isAdmin: boolean;
  configured: boolean;
  onChanged: () => void;
}) {
  const list = useApi<KbSuggestionPage>("/knowledge/suggestions?status=pending&limit=50");
  if (list.error) {
    return <ErrorState message={`Impossible de charger les propositions : ${list.error.message}`} onRetry={list.reload} />;
  }
  if (!list.data) return <Skeleton />;
  if (list.data.items.length === 0) {
    return (
      <EmptyPanel
        icon={BookPlus}
        title="Aucune réponse à valider"
        description="Quand l’agent ne sait pas répondre, le conseiller peut proposer la réponse depuis « À traiter » avec « Ajouter à la base ». Elle arrive ici."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="type-body-sm text-muted">
        {isAdmin
          ? "Relisez chaque réponse : une fois validée, elle rejoint la FAQ « Questions des prospects » du programme et l’agent s’en sert aussitôt."
          : "Ces réponses attendent la validation d’un administrateur avant d’entrer dans la base."}
      </p>
      {list.data.items.map((s, i) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          isAdmin={isAdmin}
          configured={configured}
          index={i + 1}
          onDone={() => {
            list.reload();
            onChanged();
          }}
        />
      ))}
    </div>
  );
}
