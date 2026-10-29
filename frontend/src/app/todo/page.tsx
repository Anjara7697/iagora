"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { DemoBadge, Loading, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError, qs } from "@/lib/api";
import {
  CHANNELS,
  HANDOFF_REASONS,
  PRIORITIES,
  RISKS,
  formatDate,
  fullName,
  initials,
  label,
  relativeTime,
  EXECUTION,
  STAGES,
} from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import { notifyWorkQueueChanged } from "@/lib/workQueue";
import type {
  TodoItem,
  TodoKind,
  TodoPage,
  TreatedItem,
  TreatedPage,
  Prospect,
  Membership,
} from "@/lib/types";

type KindFilter = "" | TodoKind;
type DecisionResult = { message: string; prospectName: string; treatedId?: string };
const EXECUTION_HELP: Record<TreatedItem["execution"], string> = {
  approved: "La réponse est validée, mais aucun envoi n’est encore confirmé.",
  sending: "L’envoi est en cours. Actualisez pour connaître le résultat.",
  sent: "Le service d’envoi confirme que le message a été envoyé.",
  failed: "La tentative d’envoi a échoué. Consultez le détail avant de réessayer.",
  blocked: "L’envoi est bloqué. Corrigez la cause indiquée avant de réessayer.",
  rejected: "Ce brouillon a été refusé ; aucun envoi n’a été demandé.",
};
const TASK_LABELS: Record<TodoKind, string> = {
  enrollment: "Inscriptions",
  application: "Candidatures",
  validation: "Brouillons à valider",
  escalation: "Demandes de conseiller",
  kb_gap: "Réponses à compléter",
  incident: "Incidents",
};
const TASK_ACTIONS: Record<TodoKind, string> = {
  enrollment: "Vérifier la preuve et confirmer l'inscription",
  application: "Vérifier le dossier et la campagne",
  validation: "Relire et valider la réponse",
  escalation: "Prendre le relais de l’agent",
  kb_gap: "Apporter une réponse vérifiée",
  incident: "Examiner le problème",
};
const KIND_ORDER: TodoKind[] = [
  "enrollment",
  "application",
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
            <strong>{name}</strong>
            <span className="mono">{relativeTime(item.created_at)}</span>
          </span>
          <span className="task-row-context">
            <span className={`task-kind kind-${item.kind}`}>
              {TASK_LABELS[item.kind]}
            </span>
            <span>· {label(CHANNELS, item.channel)}</span>
          </span>
          <span className="inbox-preview">
            {item.detail ? `« ${item.detail} »` : item.title}
          </span>
          <span className="task-row-action">
            {TASK_ACTIONS[item.kind]}
            <span className={`task-priority priority-${item.priority}`}>
              {label(PRIORITIES, item.priority)}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function DraftPanel({
  item,
  onDone,
}: {
  item: TodoItem;
  onDone: (result: DecisionResult) => void;
}) {
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
      notifyWorkQueueChanged();
      onDone({
        prospectName: itemName(item),
        message:
          path === "approve"
            ? "Message validé. Son état d’envoi est disponible dans « Traités »."
            : path === "reject"
              ? "Brouillon refusé. Aucun envoi n’a été demandé."
              : "Régénération demandée. Consultez la file pour retrouver la nouvelle réponse.",
        treatedId: path === "regenerate" ? undefined : item.id,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'opération");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="draft-panel" aria-label="Brouillon de l'agent">
      <header>
        <strong>
          Réponse proposée — {label(CHANNELS, item.channel)}
          {draft.subject ? ` · objet : ${draft.subject}` : ""}
        </strong>
        <span className="badge kind-validation">À relire avant validation</span>
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
      {draft.footer && (
        <div className="draft-footer">
          <span className="eyebrow">
            Pied de message — ajouté automatiquement, non modifiable
          </span>
          <p>{draft.footer}</p>
        </div>
      )}
      <p className="muted draft-exact">
        C’est le texte exact qui partira
        {draft.footer ? ", pied de message compris" : ""}.
      </p>
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
        <div className="draft-actions">
          <div className="draft-decision">
            <button
              className="primary"
              disabled={busy || !text.trim()}
              onClick={() => act("approve", { content: editing ? text : null })}
            >
              {busy
                ? "Traitement en cours…"
                : editing
                  ? "Valider la version modifiée"
                  : "Valider la réponse"}
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
          </div>
          <div className="draft-alternatives">
            <button disabled={busy} onClick={() => act("regenerate")}>
              Régénérer
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              Refuser le brouillon
            </button>
            <Link
              className="button-link"
              href={`/conversations?id=${item.conversation_id}`}
            >
              Voir l’échange complet →
            </Link>
          </div>
        </div>
      )}
      <p className="muted">
        Valider approuve le message : il part ensuite par le canal du prospect
        dès que l’envoi est activé (voir Intégrations) et que l’agent n’est pas
        en arrêt d’urgence. Son état reste lisible dans « Traités ».
      </p>
    </section>
  );
}

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

function ApplicationReview({
  item,
  onDone,
}: {
  item: TodoItem;
  onDone: (result: DecisionResult) => void;
}) {
  const user = useCurrentUser();
  const prospect = useApi<Prospect>(
    item.prospect ? `/prospects/${item.prospect.id}` : null,
  );
  const [membershipId, setMembershipId] = useState("");
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState(
    `Dossier de candidature reçu le ${formatDate(item.created_at)}, vérifié dans la boîte email.`,
  );
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
        prospectName: itemName(item),
        message: needsStage
          ? "Parcours passé à « Candidature déposée ». La demande a quitté la file."
          : "Candidature vérifiée sur le parcours choisi. La demande a quitté la file.",
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
    <section className="card review-form" aria-label="Confirmer la candidature">
      <h3>Confirmer la candidature</h3>
      <Loading
        loading={prospect.loading}
        error={prospect.error}
        onRetry={prospect.reload}
      />
      {user?.role === "VIEWER" ? (
        <p className="muted">
          Un conseiller ou administrateur peut confirmer cette candidature.
        </p>
      ) : (
        prospect.data && (
          <>
            {choices.length === 0 ? (
              <p className="muted">
                Aucun parcours ouvert pour ce prospect. Attribuez d’abord une
                campagne depuis sa fiche.
              </p>
            ) : (
              <>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                  J’ai contrôlé le dossier original dans la boîte email
                </label>
                <label>
                  Parcours concerné
                  <select
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
                  </select>
                </label>
                {needsStage && (
                  <label>
                    Motif enregistré dans l’historique
                    <textarea
                      value={reason}
                      maxLength={2000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {choices.length > 0 && (
              <div className="review-actions">
                <button
                  className="primary"
                  disabled={!canFinish || busy}
                  onClick={() => void finish()}
                >
                  {busy
                    ? "Enregistrement…"
                    : needsStage
                      ? "Passer à « Candidature déposée » et terminer"
                      : "Terminer la vérification"}
                </button>
                <span className="muted">
                  {checked
                    ? "La demande quittera la file."
                    : "Cochez le contrôle du dossier pour continuer."}
                </span>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}

function EnrollmentReview({
  item,
  onDone,
}: {
  item: TodoItem;
  onDone: (result: DecisionResult) => void;
}) {
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
        prospectName: itemName(item),
        message: "Inscription confirmée avec sa preuve. La demande a quitté la file.",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Confirmation impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card review-form" aria-label="Confirmer l'inscription depuis la preuve reçue">
      <h3>Confirmer l’inscription</h3>
      <p className="muted">
        Ouvrez l’email original, contrôlez l’identité et le programme. Le parcours
        choisi passe à « Converti ».
      </p>
      <Loading
        loading={prospect.loading}
        error={prospect.error}
        onRetry={prospect.reload}
      />
      {user?.role === "VIEWER" ? (
        <p className="muted">
          Un conseiller ou administrateur peut confirmer cette inscription.
        </p>
      ) : (
        <>
          {prospect.data && eligible.length === 0 && (
            <p className="muted">
              Aucun parcours n’est à l’étape « Candidature déposée ». La demande reste ouverte.
            </p>
          )}
          {eligible.length > 0 && (
            <label>
              Parcours confirmé par la preuve
              <select
                value={membershipId}
                onChange={(event) => setMembershipId(event.target.value)}
              >
                <option value="">Choisir le bon parcours</option>
                {eligible.map((membership) => (
                  <option key={membership.id} value={membership.id}>
                    {membershipLabel(membership)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Référence de la preuve
            <input
              value={reference}
              maxLength={300}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <label>
            Note facultative
            <textarea
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="review-actions">
            <button
              className="primary"
              disabled={!selected || reference.trim().length < 10 || busy}
              onClick={() => void confirm()}
            >
              {busy ? "Confirmation en cours…" : "Confirmer l'inscription"}
            </button>
            <button
              type="button"
              className="link"
              disabled={prospect.loading}
              onClick={prospect.reload}
            >
              Actualiser les parcours
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Detail({
  item,
  onDone,
  kind,
}: {
  item: TodoItem;
  onDone: (result: DecisionResult) => void;
  kind: KindFilter;
}) {
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
              {TASK_LABELS[item.kind]}
            </span>
            <span className={`badge priority-${item.priority}`}>
              Priorité {label(PRIORITIES, item.priority).toLowerCase()}
            </span>
            {!rec && item.prospect?.stage && <StageBadge stage={item.prospect.stage} />}
            {!rec && item.prospect?.total_score != null && (
              <ScoreBadge total={item.prospect.total_score} level={item.prospect.level} />
            )}
            <DemoBadge email={item.prospect?.email} />
          </div>
        </div>
        {item.prospect && (
          <Link
            className="button-link task-profile-link"
            href={`/prospects/${item.prospect.id}${qs({ task: item.id, kind })}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ouvrir la fiche prospect dans un nouvel onglet"
          >
            Ouvrir la fiche
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" />
            </svg>
          </Link>
        )}
      </header>

      <div className="task-context">
        <span className="sr-only">La demande à examiner</span>
        <h3>{item.title}</h3>
        {item.detail && <blockquote>« {item.detail} »</blockquote>}
        <span className="muted">
          {label(CHANNELS, item.channel)} · {formatDate(item.created_at)}
        </span>
      </div>

      {rec && (
        <section className="recommendation decision-brief" aria-label="Éléments pour décider">
          <div className="recommendation-heading">
            <span className="dot tone-ai" aria-hidden="true" />
            Prochaine action recommandée
          </div>
          <h3>{rec.action}</h3>
          {(() => {
            // Recommandation et fiche de transfert se recoupent souvent : on
            // n'affiche qu'une fois le texte le plus complet.
            const reason = rec.reason ?? "";
            const summary = item.handoff?.summary ?? "";
            const merged = summary.includes(reason) ? summary : reason;
            const extra =
              summary && !summary.includes(reason) && !reason.includes(summary);
            return (
              <>
                {merged && <p className="decision-reason">{merged}</p>}
                {extra && item.handoff && (
                  <p className="decision-reason">
                    <span className="muted">
                      {label(HANDOFF_REASONS, item.handoff.reason)} :
                    </span>{" "}
                    {summary}
                  </p>
                )}
              </>
            );
          })()}
          <div className="decision-signals">
            <span className={`badge risk-${rec.risk}`}>
              Risque : {label(RISKS, rec.risk).toLowerCase()}
            </span>
            {rec.sources.length === 0 && (
              <span className="decision-source-warning">
                Aucune source de la base de connaissances.
              </span>
            )}
          </div>
          <details className="reading-details">
            <summary>Sources, confiance et contexte</summary>
            <div className="recommendation-grid">
              <div>
                <span className="eyebrow">Sources utilisées</span>
                {rec.sources.length > 0 ? (
                  <ul>
                    {rec.sources.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : <p className="muted">Aucune source disponible.</p>}
              </div>
              <div>
                <span className="eyebrow">Confiance de l&apos;agent</span>
                <Confidence value={rec.confidence} />
                {item.draft && (
                  <>
                    <span className="eyebrow">Exécution</span>
                    <p>
                      <span className="badge integ-warn">
                        {label(EXECUTION, "pending")}
                      </span>
                    </p>
                  </>
                )}
              </div>
              {item.prospect && (
                <div>
                  <span className="eyebrow">Contexte commercial</span>
                  <div className="row">
                    {item.prospect.stage && <StageBadge stage={item.prospect.stage} />}
                    {item.prospect.total_score != null && (
                      <ScoreBadge total={item.prospect.total_score} level={item.prospect.level} />
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>
        </section>
      )}

      {item.draft && <DraftPanel key={item.id} item={item} onDone={onDone} />}

      {item.kind === "application" && (
        <ApplicationReview item={item} onDone={onDone} />
      )}

      {item.kind === "enrollment" && (
        <EnrollmentReview item={item} onDone={onDone} />
      )}

      {item.handoff && rec && (
        <p className="handoff-link">
          <Link href={`/conversations?id=${item.conversation_id}`}>
            Répondre dans la conversation →
          </Link>
        </p>
      )}

      {item.handoff && !rec && (
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

function TreatedDetail({
  item,
  onChanged,
  refreshing,
}: {
  item: TreatedItem;
  onChanged: () => void;
  refreshing: boolean;
}) {
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const messageId = item.id.split(":")[2];
  const name = item.prospect
    ? fullName(item.prospect) || item.prospect.email || "Prospect"
    : "Prospect";
  const canRetry =
    item.decision === "approved" &&
    (item.execution === "failed" || item.execution === "blocked") &&
    user?.role !== "VIEWER";

  async function retry() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(
        `/conversations/${item.conversation_id}/messages/${messageId}/retry-delivery`,
        {
          method: "POST",
        },
      );
      setNotice("Nouvelle tentative demandée.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inbox-detail" aria-label={`Traité : ${name}`}>
      <header className="inbox-detail-head treated-detail-head">
        <span className="prospect-avatar inbox-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <div className="inbox-detail-title">
          <h2>{name}</h2>
          <DemoBadge email={item.prospect?.email} />
          <div className="row">
            <span
              className={`badge ${item.decision === "approved" ? "integ-ok" : "integ-off"}`}
            >
              {item.decision === "approved" ? "Validé" : "Refusé"}
              {item.edited ? " (modifié)" : ""}
            </span>
            <span className="muted">{formatDate(item.decided_at)}</span>
          </div>
        </div>
        <Link
          className="button-link"
          href={`/conversations?id=${item.conversation_id}`}
        >
          Ouvrir la conversation
        </Link>
      </header>
      <section
        className={`delivery-status execution-${item.execution}`}
        aria-label="État d’envoi"
      >
        <div className="delivery-status-heading">
          <div>
            <span className="eyebrow">État d’envoi</span>
            <h3>{label(EXECUTION, item.execution)}</h3>
          </div>
          <button disabled={busy || refreshing} onClick={onChanged}>
            {refreshing ? "Actualisation…" : "Actualiser l’état"}
          </button>
        </div>
        <p>{EXECUTION_HELP[item.execution]}</p>
        {item.reason && <p>Motif du refus : {item.reason}</p>}
        {item.execution_detail && (
          <p className="delivery-detail">{item.execution_detail}</p>
        )}
        {canRetry && (
          <button disabled={busy || refreshing} onClick={retry}>
            {busy ? "Nouvelle tentative…" : "Réessayer l’envoi"}
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="draft-panel" aria-label="Message traité">
        <header>
          <strong>Message — {label(CHANNELS, item.channel)}</strong>
        </header>
        <div className="draft-text">{item.content}</div>
      </section>
    </section>
  );
}

function Todo() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const [showAllKinds, setShowAllKinds] = useState(false);
  const kind: KindFilter = KIND_ORDER.includes(params.get("kind") as TodoKind)
    ? (params.get("kind") as TodoKind)
    : "";
  function setKind(value: KindFilter) {
    router.replace(`/todo${qs({ kind: value, id: selectedId })}`, {
      scroll: false,
    });
  }
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState<DecisionResult | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!notice) return;
    noticeRef.current?.focus({ preventScroll: true });
    noticeRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [notice]);
  const list = useApi<TodoPage>(`/todo${qs({ kind, limit: 50, offset })}`);
  const all = useApi<TodoPage>("/todo?limit=1");
  const tab = params.get("tab") === "treated" ? "treated" : "todo";
  const treated = useApi<TreatedPage>("/todo/treated", { keepPrevious: true });
  const treatedItems = treated.data?.items ?? [];
  const selectedTreated = treatedItems.find((i) => i.id === selectedId) ?? null;

  const items = list.data?.items ?? [];
  const inPage = items.find((i) => i.id === selectedId) ?? null;
  const direct = useApi<TodoItem>(
    tab === "todo" && selectedId && !inPage
      ? `/todo/item${qs({ id: selectedId })}`
      : null,
  );
  const selected =
    inPage ?? (direct.data?.id === selectedId ? direct.data : null);
  const counts = all.data?.counts ?? {};
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  const refresh = () => {
    list.reload();
    all.reload();
    treated.reload();
    direct.reload();
  };

  return (
    <div className="review-workspace">
      <h1 className="sr-only">À traiter</h1>
      {notice && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          className="review-notice"
          role="status"
          aria-label="Résultat de la décision"
        >
          <div>
            <strong>{notice.prospectName}</strong>
            <p>✓ {notice.message}</p>
          </div>
          {notice.treatedId && (
            <Link
              className="button-link"
              href={`/todo${qs({ tab: "treated", id: notice.treatedId })}`}
            >
              Consulter la décision →
            </Link>
          )}
        </div>
      )}
      {selectedId && (
        <div className="inbox-mobile-nav">
          <button
            onClick={() =>
              router.replace(
                `/todo${qs({ kind, tab: tab === "treated" ? "treated" : undefined })}`,
                { scroll: false },
              )
            }
          >
            ← Liste des éléments
          </button>
        </div>
      )}
      <div className="inbox" data-selected={!!selectedId}>
        <aside className="inbox-list" aria-label="Éléments à traiter">
          <header className="task-list-heading">
            <h2>Votre file de travail</h2>
            <span className="review-count" aria-label="Éléments en attente">
              <strong>{all.data ? total : "—"}</strong> en attente
            </span>
          </header>
          <div
            className="view-switch todo-tabs"
            role="group"
            aria-label="Affichage"
          >
            <button
              aria-pressed={tab === "todo"}
              onClick={() => router.replace("/todo", { scroll: false })}
            >
              À traiter
            </button>
            <button
              aria-pressed={tab === "treated"}
              onClick={() =>
                router.replace("/todo?tab=treated", { scroll: false })
              }
            >
              Traités (24 h) ({treated.data?.total ?? "—"})
            </button>
          </div>
          {tab === "treated" && (
            <>
              <Loading
                loading={treated.loading && !treated.data}
                error={treated.error}
                onRetry={treated.reload}
              />
              {treated.data && treatedItems.length === 0 && (
                <p className="muted inbox-empty">
                  Rien de traité pour l’instant. Chaque élément traité vient ici
                  avec sa trace : qui a agi, quand, et ce qui est parti.
                </p>
              )}
              <ul>
                {treatedItems.map((t) => {
                  const name = t.prospect
                    ? fullName(t.prospect) || t.prospect.email || "Prospect"
                    : "Prospect";
                  return (
                    <li key={t.id}>
                      <button
                        className={`inbox-row ${t.id === selectedId ? "selected" : ""}`}
                        aria-current={t.id === selectedId ? "true" : undefined}
                        onClick={() =>
                          router.replace(
                            `/todo?tab=treated&id=${encodeURIComponent(t.id)}`,
                            {
                              scroll: false,
                            },
                          )
                        }
                      >
                        <span className="prospect-avatar" aria-hidden="true">
                          {initials(name)}
                        </span>
                        <span className="inbox-row-main">
                          <span className="inbox-row-top">
                            <strong>{name}</strong>
                            <span className="mono">
                              {formatDate(t.decided_at)}
                            </span>
                          </span>
                          <span className="row">
                            <span
                              className={`badge ${t.decision === "approved" ? "integ-ok" : "integ-off"}`}
                            >
                              {t.decision === "approved" ? "Validé" : "Refusé"}
                            </span>
                            <span className="badge">
                              {label(EXECUTION, t.execution)}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="inbox-filters" hidden={tab === "treated"}>
            <div className="chips" role="group" aria-label="Type">
              <button
                aria-pressed={kind === ""}
                onClick={() => {
                  setKind("");
                  setOffset(0);
                }}
              >
                Tout ({total})
              </button>
              {KIND_ORDER.filter(
                (k) => showAllKinds || kind === k || (counts[k] ?? 0) > 0,
              ).map((k) => (
                <button
                  key={k}
                  aria-pressed={kind === k}
                  onClick={() => {
                    setKind(k);
                    setOffset(0);
                  }}
                >
                  {TASK_LABELS[k]} ({counts[k] ?? 0})
                </button>
              ))}
              {KIND_ORDER.some((k) => (counts[k] ?? 0) === 0 && kind !== k) && (
                <button
                  type="button"
                  className="chips-more"
                  aria-expanded={showAllKinds}
                  onClick={() => setShowAllKinds(!showAllKinds)}
                >
                  {showAllKinds ? "Masquer les types vides" : "Autres types"}
                </button>
              )}
            </div>
          </div>
          {tab === "todo" && (
            <Loading
              loading={list.loading}
              error={list.error}
              onRetry={list.reload}
            />
          )}
          {tab === "todo" && list.data && items.length === 0 && (
            <p className="muted inbox-empty">Rien à traiter pour le moment.</p>
          )}
          <ul hidden={tab === "treated"}>
            {items.map((i) => (
              <Row
                key={i.id}
                item={i}
                selected={i.id === selectedId}
                onSelect={() =>
                  router.replace(`/todo${qs({ kind, id: i.id })}`, {
                    scroll: false,
                  })
                }
              />
            ))}
          </ul>
          {tab === "todo" &&
            list.data &&
            (list.data.total > 50 || offset > 0) && (
              <div className="pager">
                <button
                  disabled={offset === 0 || list.loading}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Éléments précédents
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + 50, list.data.total)} /{" "}
                  {list.data.total}
                </span>
                <button
                  disabled={offset + 50 >= list.data.total || list.loading}
                  onClick={() => setOffset(offset + 50)}
                >
                  Éléments suivants
                </button>
              </div>
            )}
        </aside>
        {tab === "treated" && selectedTreated ? (
          <TreatedDetail
            key={selectedTreated.id}
            item={selectedTreated}
            onChanged={treated.reload}
            refreshing={treated.loading}
          />
        ) : tab === "treated" && selectedId ? (
          <section
            className="inbox-detail inbox-placeholder"
            aria-label="Décision recherchée"
          >
            <Loading
              loading={treated.loading}
              error={treated.error}
              onRetry={treated.reload}
            />
            {!treated.loading && !treated.error && treated.data && (
              <div className="review-start">
                <h2>Cette décision n’est pas dans la liste.</h2>
                <p>
                  Les décisions affichées couvrent les dernières 24 heures.
                  Retrouvez l’échange dans les conversations ou actualisez la liste.
                </p>
                <button onClick={treated.reload}>Actualiser les décisions</button>
                <Link className="button-link" href="/conversations">
                  Consulter les conversations
                </Link>
              </div>
            )}
          </section>
        ) : tab === "todo" && selected ? (
          <Detail
            key={selected.id}
            item={selected}
            kind={kind}
            onDone={(result) => {
              setNotice(result);
              router.replace(`/todo${qs({ kind })}`, { scroll: false });
              refresh();
            }}
          />
        ) : tab === "todo" && selectedId ? (
          <section className="inbox-detail inbox-placeholder">
            <Loading
              loading={direct.loading}
              error={direct.error}
              onRetry={direct.reload}
            />
            {direct.error?.status === 404 && (
              <Link href="/conversations">Consulter les conversations</Link>
            )}
          </section>
        ) : (
          <section className="inbox-detail inbox-placeholder">
            <div className="review-start">
              <span className="review-start-mark" aria-hidden="true">
                ✓
              </span>
              <span className="eyebrow">Un regard humain, au bon moment</span>
              <h2>
                {tab === "treated"
                  ? "Retrouvez vos décisions"
                  : list.loading
                    ? "Chargement de votre file…"
                    : list.error
                      ? "La file est indisponible."
                      : items.length
                        ? "Faisons avancer vos échanges."
                        : kind
                          ? "Aucune demande de ce type."
                          : "Votre file est à jour."}
              </h2>
              <p>
                {tab === "treated"
                  ? "Sélectionnez un message pour consulter la décision et son état d’envoi."
                  : list.loading
                    ? "Nous récupérons les demandes à examiner."
                    : list.error
                      ? "Réessayez depuis la liste pour retrouver vos demandes."
                      : items.length
                        ? "Choisissez une demande à gauche. Vous retrouverez son contexte, la réponse proposée et les éléments pour décider."
                        : "Les nouvelles demandes apparaîtront ici. Vous pouvez retrouver les échanges en cours dans les conversations."}
              </p>
              {tab === "todo" && items[0] && (
                <button
                  className="primary"
                  onClick={() =>
                    router.replace(`/todo${qs({ kind, id: items[0].id })}`, {
                      scroll: false,
                    })
                  }
                >
                  Examiner la première demande →
                </button>
              )}
              {tab === "todo" &&
                !list.loading &&
                !list.error &&
                !items.length && (
                  <Link className="button-link" href="/conversations">
                    Voir les conversations
                  </Link>
                )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function TodoPageRoute() {
  return (
    <Suspense fallback={<p className="muted">Chargement…</p>}>
      <Todo />
    </Suspense>
  );
}
