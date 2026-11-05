"use client";

/** Revues humaines d'« À traiter » : candidature déposée et inscription confirmée par une preuve. */

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Btn, Check as CheckBox, ErrorText, Field, Notice, SelectBox, TextBox, TextInput } from "@/components/ds/controls";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate, label, STAGES } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import { notifyWorkQueueChanged } from "@/lib/workQueue";
import type { Prospect, Membership } from "@/lib/types";
import { Box } from "@/components/ds/card";
import { PanelProps, useReportDirty, itemName } from "@/components/todo/shared";

const PRE_APPLICATION_STAGES = [
  "new",
  "to_qualify",
  "contacted",
  "in_conversation",
  "qualified",
  "meeting_proposed",
  "meeting_scheduled",
  "meeting_done",
  "to_follow_up",
];

function membershipLabel(m: Membership): string {
  return `${m.campaign_name ?? "Campagne sans nom"} · ${m.source_name ?? "source inconnue"}`;
}

function ReviewCard({ label: aria, title, intro, children }: { label: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <Box as="section" className="gap-4 p-5" aria-label={aria}>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {intro && <p className="text-[13px] text-muted">{intro}</p>}
      </div>
      {children}
    </Box>
  );
}

export function ApplicationReview({ item, onDone, onDirtyChange }: PanelProps) {
  const user = useCurrentUser();
  const prospect = useApi<Prospect>(
    item.prospect ? `/prospects/${item.prospect.id}` : null,
  );
  const [membershipId, setMembershipId] = useState("");
  const [checked, setChecked] = useState(false);
  const [initialReason] = useState(
    `Dossier de candidature reçu le ${formatDate(item.created_at)}, vérifié dans la boîte email.`,
  );
  const [reason, setReason] = useState(initialReason);
  useReportDirty(reason !== initialReason, onDirtyChange);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memberships = prospect.data?.campaigns ?? [];
  // Parcours déjà à « Candidature déposée » : il suffit de terminer la revue.
  const applied = memberships.filter((m) =>
    ["applied", "converted"].includes(m.conversion_stage),
  );
  // Sinon, le conseiller passe le bon parcours à « Candidature déposée » d'ici.
  const open = memberships.filter((m) =>
    PRE_APPLICATION_STAGES.includes(m.conversion_stage),
  );
  const choices = applied.length > 0 ? applied : open;
  const selected =
    choices.find((m) => String(m.id) === membershipId) ??
    (choices.length === 1 ? choices[0] : undefined);
  const needsStage = !!selected && !applied.includes(selected);
  const canFinish =
    !!selected && checked && (!needsStage || reason.trim().length > 0);

  async function finish() {
    if (!selected || !canFinish) return;
    setBusy(true);
    setError(null);
    try {
      if (needsStage)
        await api(`/campaign-prospects/${selected.id}`, {
          method: "PATCH",
          body: { conversion_stage: "applied", reason: reason.trim() },
        });
      await api(`/conversations/${item.conversation_id}/resolve-application`, {
        method: "POST",
        body: { membership_id: selected.id },
      });
      notifyWorkQueueChanged();
      onDone({
        title: "Candidature vérifiée",
        description: needsStage
          ? `${itemName(item)} : parcours passé à « Candidature déposée ». La demande a quitté la file.`
          : `${itemName(item)} : candidature vérifiée sur le parcours choisi. La demande a quitté la file.`,
      });
    } catch (err) {
      prospect.reload();
      setError(
        err instanceof ApiError ? err.message : "Vérification impossible",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReviewCard label="Confirmer la candidature" title="Confirmer la candidature">
      <Loading
        loading={prospect.loading}
        error={prospect.error}
        onRetry={prospect.reload}
      />
      {user?.role === "VIEWER" ? (
        <Notice tone="info">Un conseiller ou administrateur peut confirmer cette candidature.</Notice>
      ) : (
        prospect.data && (
          <>
            {choices.length === 0 ? (
              <Notice tone="warning">
                Aucun parcours ouvert pour ce prospect. Attribuez d’abord une campagne depuis sa fiche.
              </Notice>
            ) : (
              <>
                <CheckBox checked={checked} onChange={setChecked}>
                  J’ai contrôlé le dossier original dans la boîte email
                </CheckBox>
                <Field label="Parcours concerné">
                  <SelectBox
                    variant="secondary"
                    value={selected ? String(selected.id) : ""}
                    onChange={(e) => setMembershipId(e.target.value)}
                  >
                    {choices.length > 1 && (
                      <option value="">Choisir le parcours</option>
                    )}
                    {choices.map((m) => (
                      <option key={m.id} value={m.id}>
                        {membershipLabel(m)} · étape actuelle :{" "}
                        {label(STAGES, m.conversion_stage)}
                      </option>
                    ))}
                  </SelectBox>
                </Field>
                {needsStage && (
                  <Field label="Motif enregistré dans l’historique">
                    <TextBox
                      variant="secondary"
                      value={reason}
                      maxLength={2000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                )}
              </>
            )}
            {error && <ErrorText>{error}</ErrorText>}
            {choices.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Btn
                  variant="primary"
                  disabled={!canFinish || busy}
                  onClick={() => void finish()}
                >
                  {busy
                    ? "Enregistrement…"
                    : needsStage
                      ? "Passer à « Candidature déposée » et terminer"
                      : "Terminer la vérification"}
                </Btn>
                <span className="text-[13px] text-muted">
                  {checked
                    ? "La demande quittera la file."
                    : "Cochez le contrôle du dossier pour continuer."}
                </span>
              </div>
            )}
          </>
        )
      )}
    </ReviewCard>
  );
}

export function EnrollmentReview({ item, onDone, onDirtyChange }: PanelProps) {
  const user = useCurrentUser();
  const prospect = useApi<Prospect>(
    item.prospect ? `/prospects/${item.prospect.id}` : null,
  );
  const [membershipId, setMembershipId] = useState("");
  const [reference, setReference] = useState(
    item.handoff?.evidence_reference ?? "",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useReportDirty(reference !== (item.handoff?.evidence_reference ?? "") || note.trim() !== "", onDirtyChange);
  const eligible =
    prospect.data?.campaigns.filter((m) =>
      ["applied", "converted"].includes(m.conversion_stage),
    ) ?? [];
  const selected = eligible.find((m) => String(m.id) === membershipId);

  async function confirm() {
    if (!selected || reference.trim().length < 10) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/conversations/${item.conversation_id}/confirm-enrollment-email`,
        {
          method: "POST",
          body: {
            membership_id: selected.id,
            evidence_reference: reference.trim(),
            note: note.trim() || null,
          },
        },
      );
      notifyWorkQueueChanged();
      onDone({
        title: "Inscription confirmée",
        description: `${itemName(item)} : preuve enregistrée, la demande a quitté la file.`,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Confirmation impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReviewCard
      label="Confirmer l'inscription depuis la preuve reçue"
      title="Confirmer l’inscription"
      intro="Ouvrez l’email original, contrôlez l’identité et le programme. Le parcours choisi passe à « Converti »."
    >
      <Loading
        loading={prospect.loading}
        error={prospect.error}
        onRetry={prospect.reload}
      />
      {user?.role === "VIEWER" ? (
        <Notice tone="info">Un conseiller ou administrateur peut confirmer cette inscription.</Notice>
      ) : (
        <>
          {prospect.data && eligible.length === 0 && (
            <Notice tone="warning">
              Aucun parcours n’est à l’étape « Candidature déposée ». La demande reste ouverte.
            </Notice>
          )}
          {eligible.length > 0 && (
            <Field label="Parcours confirmé par la preuve">
              <SelectBox
                variant="secondary"
                value={membershipId}
                onChange={(event) => setMembershipId(event.target.value)}
              >
                <option value="">Choisir le bon parcours</option>
                {eligible.map((membership) => (
                  <option key={membership.id} value={membership.id}>
                    {membershipLabel(membership)}
                  </option>
                ))}
              </SelectBox>
            </Field>
          )}
          <Field label="Référence de la preuve">
            <TextInput
              variant="secondary"
              value={reference}
              maxLength={300}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <Field label="Note facultative">
            <TextBox
              variant="secondary"
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex flex-wrap items-center gap-2">
            <Btn
              variant="primary"
              disabled={!selected || reference.trim().length < 10 || busy}
              onClick={() => void confirm()}
            >
              {busy ? "Confirmation en cours…" : "Confirmer l'inscription"}
            </Btn>
            <Btn variant="ghost" disabled={prospect.loading} onClick={prospect.reload}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Actualiser les parcours
            </Btn>
          </div>
        </>
      )}
    </ReviewCard>
  );
}
