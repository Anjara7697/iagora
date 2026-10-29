"use client";

import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { STAGES } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Membership, Page } from "@/lib/types";

type Advisor = { id: number; username: string };

export default function MembershipActions({
  membership: m,
  onDone,
}: {
  membership: Membership;
  onDone: () => void;
}) {
  const user = useCurrentUser();
  const [offset, setOffset] = useState(0);
  const advisors = useApi<Page<Advisor>>(`/advisors?limit=50&offset=${offset}`);
  const [advisor, setAdvisor] = useState(String(m.assigned_advisor_id ?? ""));
  const [stage, setStage] = useState(m.conversion_stage);
  const [reason, setReason] = useState("");
  const [evidenceType, setEvidenceType] = useState("school_email");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = advisors.data?.items.find(
    (a) => a.id === m.assigned_advisor_id,
  );
  const currentName = m.assigned_advisor_id
    ? (current?.username ?? `Conseiller #${m.assigned_advisor_id}`)
    : "Non affecté";
  const canWrite = user?.role === "ADMIN" || user?.role === "ADVISOR";

  async function save(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/campaign-prospects/${m.id}`, { method: "PATCH", body });
      setNotice(message);
      setReason("");
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Modification impossible",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/campaign-prospects/${m.id}/confirm-enrollment`, {
        method: "POST",
        body: {
          evidence_type: evidenceType,
          evidence_reference: evidenceReference.trim(),
          note: evidenceNote.trim() || null,
        },
      });
      setNotice("Inscription confirmée et historisée.");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Confirmation impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="membership-actions"
      aria-label={`Suivi du parcours ${m.id}`}
    >
      <p>
        Conseiller affecté : <strong>{currentName}</strong>
      </p>
      <p className="muted">
        {m.assignment_is_override
          ? "Exception individuelle à la règle de campagne."
          : "Affectation selon la règle de campagne."}
      </p>
      <Loading
        loading={advisors.loading}
        error={advisors.error}
        onRetry={advisors.reload}
      />
      {user?.role === "ADMIN" && (
        <form
          aria-label={`Affectation du parcours ${m.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              { assigned_advisor_id: advisor ? Number(advisor) : null },
              "Affectation enregistrée.",
            );
          }}
        >
          <p className="muted">
            Une modification ici crée une exception pour ce prospect dans cette
            campagne, sur toutes ses sources.
          </p>
          <label>
            Conseiller responsable
            <select
              value={advisor}
              disabled={busy || advisors.loading || !!advisors.error}
              onChange={(e) => setAdvisor(e.target.value)}
            >
              <option value="">Non affecté</option>
              {advisor &&
                !advisors.data?.items.some((a) => String(a.id) === advisor) && (
                  <option value={advisor}>
                    Conseiller #{advisor} (hors de cette page ou indisponible)
                  </option>
                )}
              {advisors.data?.items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </select>
          </label>
          {advisors.data && advisors.data.total > 50 && (
            <div className="row">
              <button
                type="button"
                disabled={busy || offset === 0}
                onClick={() => setOffset(offset - 50)}
              >
                Conseillers précédents
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 50, advisors.data.total)} /{" "}
                {advisors.data.total}
              </span>
              <button
                type="button"
                disabled={busy || offset + 50 >= advisors.data.total}
                onClick={() => setOffset(offset + 50)}
              >
                Conseillers suivants
              </button>
            </div>
          )}
          <button
            disabled={
              busy ||
              advisors.loading ||
              !!advisors.error ||
              advisor === String(m.assigned_advisor_id ?? "")
            }
          >
            Enregistrer l’affectation
          </button>
          {m.assignment_is_override && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void save(
                  { inherit_campaign_advisor: true },
                  "Règle de campagne rétablie.",
                )
              }
            >
              Suivre le responsable de campagne
            </button>
          )}
        </form>
      )}
      {canWrite && (
        <form
          aria-label={`Étape du parcours ${m.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              { conversion_stage: stage, reason: reason.trim() },
              "Étape enregistrée.",
            );
          }}
        >
          <label>
            Nouvelle étape
            <select
              value={stage}
              disabled={busy}
              onChange={(e) => setStage(e.target.value)}
            >
              {Object.entries(STAGES)
                .filter(([value]) => value !== "converted" || m.conversion_stage === "converted")
                .map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Motif du changement
            <textarea
              value={reason}
              disabled={busy}
              required
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={busy || stage === m.conversion_stage || !reason.trim()}
          >
            Enregistrer l’étape
          </button>
        </form>
      )}
      {canWrite && m.conversion_stage === "applied" && (
        <form
          aria-label={`Confirmation de l'inscription du parcours ${m.id}`}
          onSubmit={(event) => {
            event.preventDefault();
            void confirmEnrollment();
          }}
        >
          <h3>Confirmer l’inscription</h3>
          <p className="muted">
            Vérifiez la confirmation de l’école avant de passer ce parcours à « Converti ».
            La déclaration du candidat ou son dossier ne suffisent pas.
          </p>
          <label>
            Preuve vérifiée
            <select value={evidenceType} disabled={busy} onChange={(e) => setEvidenceType(e.target.value)}>
              <option value="school_email">Email de confirmation de l’école</option>
              <option value="admissions_system">Système d’admission</option>
              <option value="signed_document">Document signé</option>
              <option value="other">Autre preuve vérifiée</option>
            </select>
          </label>
          <label>
            Référence de la preuve
            <input
              value={evidenceReference}
              onChange={(e) => setEvidenceReference(e.target.value)}
              disabled={busy}
              required
              minLength={10}
              maxLength={300}
              placeholder="Ex. email du service admissions du 27/10"
            />
          </label>
          <label>
            Note complémentaire (facultative)
            <textarea
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              disabled={busy}
              maxLength={1000}
            />
          </label>
          <button disabled={busy || evidenceReference.trim().length < 10}>
            Confirmer l’inscription
          </button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
