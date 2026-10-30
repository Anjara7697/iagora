"use client";

import { Avatar } from "@heroui/react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  History,
  ListChecks,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import {
  Btn,
  Check as CheckBox,
  ErrorText,
  Field,
  FilterChip,
  LinkButton,
  NativeSelect,
  Notice,
  Segmented,
  Tag,
  TextBox,
  TextInput,
  TextLink,
  type Tone,
} from "@/components/ds/controls";
import { EmptyPanel, Eyebrow, PageHeader, Screen } from "@/components/ds/layout";
import { DemoBadge, Loading, ScoreBadge, StageBadge, Skeleton } from "@/components/ui";
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

const KIND_TONE: Record<TodoKind, Tone> = {
  enrollment: "success",
  application: "success",
  validation: "warning",
  escalation: "accent",
  kb_gap: "agent",
  incident: "danger",
};
const PRIORITY_TONE: Record<string, Tone> = {
  critical: "danger",
  high: "warning",
  medium: "neutral",
  low: "muted",
};
const RISK_TONE: Record<string, Tone> = { low: "success", medium: "warning", high: "danger" };
const EXECUTION_TONE: Record<string, Tone> = {
  approved: "accent",
  sending: "accent",
  sent: "success",
  failed: "danger",
  blocked: "danger",
  rejected: "neutral",
};

function Confidence({ value }: { value: number | null }) {
  if (value === null) return <p className="text-sm text-muted">Non évaluée</p>;
  const percent = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2" aria-label={`Confiance ${percent} %`}>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-tertiary" aria-hidden="true">
        <span
          className={`block h-full rounded-full ${value < 0.6 ? "bg-warning" : "bg-agent"}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-[13px] text-foreground tabular-nums">{percent} %</span>
    </div>
  );
}

function PersonMark({ name, incident }: { name: string; incident?: boolean }) {
  return incident ? (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-soft-foreground" aria-hidden="true">
      <AlertTriangle className="size-4" />
    </span>
  ) : (
    <Avatar size="sm" variant="soft" color="accent" aria-hidden="true">
      <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
    </Avatar>
  );
}

const rowClass = (selected: boolean) =>
  `flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus ${
    selected ? "bg-accent-soft" : "hover:bg-surface-secondary"
  }`;

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
      <button className={rowClass(selected)} aria-current={selected} onClick={onSelect}>
        <PersonMark name={name} incident={item.kind === "incident"} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</strong>
            <span className="shrink-0 text-xs text-muted">{relativeTime(item.created_at)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Tag tone={KIND_TONE[item.kind]}>{TASK_LABELS[item.kind]}</Tag>
            <Tag tone={PRIORITY_TONE[item.priority] ?? "neutral"}>
              {label(PRIORITIES, item.priority)}
            </Tag>
            <span>{label(CHANNELS, item.channel)}</span>
          </span>
          <span className="line-clamp-2 text-[13px]/[18px] text-foreground/80">
            {item.detail ? `« ${item.detail} »` : item.title}
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
    <section className="draft-panel card card--default gap-0 p-0" aria-label="Brouillon de l'agent">
      <header className="flex flex-wrap items-center gap-2 border-b border-separator px-5 py-3.5">
        <strong className="flex-1 text-sm font-semibold text-foreground">
          Réponse proposée — {label(CHANNELS, item.channel)}
          {draft.subject ? ` · objet : ${draft.subject}` : ""}
        </strong>
        <Tag tone="warning">À relire avant validation</Tag>
      </header>
      <div className="flex flex-col gap-3 px-5 py-4">
        {editing ? (
          <TextBox
            aria-label="Texte du brouillon"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-40"
          />
        ) : (
          <div className="text-sm/6 whitespace-pre-wrap text-foreground">{text}</div>
        )}
        {draft.footer && (
          <div className="flex flex-col gap-1 rounded-xl bg-surface-secondary px-4 py-3">
            <Eyebrow>Pied de message — ajouté automatiquement, non modifiable</Eyebrow>
            <p className="text-[13px] whitespace-pre-wrap text-muted">{draft.footer}</p>
          </div>
        )}
        <p className="text-xs text-muted">
          C’est le texte exact qui partira
          {draft.footer ? ", pied de message compris" : ""}.
        </p>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
      {readOnly ? (
        <p className="border-t border-separator px-5 py-3 text-[13px] text-muted">
          Votre accès observateur permet de consulter les brouillons.
        </p>
      ) : rejecting ? (
        <div className="flex flex-col gap-3 border-t border-separator px-5 py-4">
          <Field label="Motif du refus">
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex. ton trop familier"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() => act("reject", { reason: reason.trim() })}
            >
              Confirmer le refus
            </Btn>
            <Btn disabled={busy} onClick={() => setRejecting(false)}>
              Annuler
            </Btn>
          </div>
        </div>
      ) : (
        <div className="draft-actions sticky bottom-3 z-10 mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/95 px-3 py-3 shadow-overlay backdrop-blur-md">
          <div className="draft-decision flex flex-wrap gap-2 max-sm:w-full">
            <Btn
              variant="primary"
              className="max-sm:basis-full"
              disabled={busy || !text.trim()}
              onClick={() => act("approve", { content: editing ? text : null })}
            >
              <Check className="size-4" aria-hidden="true" />
              {busy
                ? "Traitement en cours…"
                : editing
                  ? "Valider la version modifiée"
                  : "Valider la réponse"}
            </Btn>
            <Btn
              className="max-sm:flex-1"
              disabled={busy}
              onClick={() =>
                editing
                  ? (setText(draft.content), setEditing(false))
                  : setEditing(true)
              }
            >
              <Pencil className="size-4" aria-hidden="true" />
              {editing ? "Annuler la modification" : "Modifier"}
            </Btn>
          </div>
          <span className="flex-1 max-sm:hidden" />
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            <Btn variant="ghost" disabled={busy} onClick={() => act("regenerate")}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Régénérer
            </Btn>
            <Btn variant="danger-soft" disabled={busy} onClick={() => setRejecting(true)}>
              Refuser le brouillon
            </Btn>
            <TextLink href={`/conversations?id=${item.conversation_id}`} className="px-1 max-sm:basis-full">
              Voir l’échange complet →
            </TextLink>
          </div>
        </div>
      )}
      <p className="border-t border-separator px-5 py-3 text-xs/[18px] text-muted">
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

function ReviewCard({ label: aria, title, intro, children }: { label: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="card card--default gap-4 p-5" aria-label={aria}>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {intro && <p className="text-[13px] text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
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
    <ReviewCard label="Confirmer la candidature" title="Confirmer la candidature">
      <Loading
        loading={prospect.loading}
        error={prospect.error}
        onRetry={prospect.reload}
      />
      {user?.role === "VIEWER" ? (
        <p className="text-[13px] text-muted">
          Un conseiller ou administrateur peut confirmer cette candidature.
        </p>
      ) : (
        prospect.data && (
          <>
            {choices.length === 0 ? (
              <p className="text-[13px] text-muted">
                Aucun parcours ouvert pour ce prospect. Attribuez d’abord une
                campagne depuis sa fiche.
              </p>
            ) : (
              <>
                <CheckBox checked={checked} onChange={setChecked}>
                  J’ai contrôlé le dossier original dans la boîte email
                </CheckBox>
                <Field label="Parcours concerné">
                  <NativeSelect
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
                  </NativeSelect>
                </Field>
                {needsStage && (
                  <Field label="Motif enregistré dans l’historique">
                    <TextBox
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
        <p className="text-[13px] text-muted">
          Un conseiller ou administrateur peut confirmer cette inscription.
        </p>
      ) : (
        <>
          {prospect.data && eligible.length === 0 && (
            <p className="text-[13px] text-muted">
              Aucun parcours n’est à l’étape « Candidature déposée ». La demande reste ouverte.
            </p>
          )}
          {eligible.length > 0 && (
            <Field label="Parcours confirmé par la preuve">
              <NativeSelect
                value={membershipId}
                onChange={(event) => setMembershipId(event.target.value)}
              >
                <option value="">Choisir le bon parcours</option>
                {eligible.map((membership) => (
                  <option key={membership.id} value={membership.id}>
                    {membershipLabel(membership)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Référence de la preuve">
            <TextInput
              value={reference}
              maxLength={300}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <Field label="Note facultative">
            <TextBox
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

function DetailHead({
  name,
  incident,
  chips,
  action,
}: {
  name: string;
  incident?: boolean;
  chips: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start gap-3">
      <PersonMark name={name} incident={incident} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-foreground">{name}</h2>
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      </div>
      {action}
    </header>
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
    <section className="mx-auto flex w-full max-w-[980px] min-w-0 flex-1 flex-col gap-4" aria-label={`À traiter : ${name}`}>
      <DetailHead
        name={name}
        incident={item.kind === "incident"}
        chips={
          <>
            <Tag tone={KIND_TONE[item.kind]}>{TASK_LABELS[item.kind]}</Tag>
            <Tag tone={PRIORITY_TONE[item.priority] ?? "neutral"}>
              Priorité {label(PRIORITIES, item.priority).toLowerCase()}
            </Tag>
            {!rec && item.prospect?.stage && <StageBadge stage={item.prospect.stage} />}
            {!rec && item.prospect?.total_score != null && (
              <ScoreBadge total={item.prospect.total_score} level={item.prospect.level} />
            )}
            <DemoBadge email={item.prospect?.email} />
          </>
        }
        action={
          item.prospect && (
            <LinkButton
              variant="outline"
              size="sm"
              href={`/prospects/${item.prospect.id}${qs({ task: item.id, kind })}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Ouvrir la fiche prospect dans un nouvel onglet"
            >
              Ouvrir la fiche
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </LinkButton>
          )
        }
      />

      <div className="card card--default gap-2 p-5">
        <span className="sr-only">La demande à examiner</span>
        <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
        {item.detail && (
          <blockquote className="rounded-xl border-l-2 border-border bg-surface-secondary px-4 py-3 text-sm whitespace-pre-wrap text-foreground">
            « {item.detail} »
          </blockquote>
        )}
        <span className="text-xs text-muted">
          {label(CHANNELS, item.channel)} · {formatDate(item.created_at)}
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {rec && (
          <section
            className="card card--default gap-0 overflow-hidden p-0 shadow-[var(--surface-shadow),inset_0_0_0_1px_color-mix(in_oklab,var(--agent)_22%,transparent)]"
            aria-label="Éléments pour décider"
          >
            <div className="flex flex-col gap-3 bg-agent-soft px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-lg bg-agent text-agent-foreground" aria-hidden="true">
                  <Sparkles className="size-3.5" />
                </span>
                <span className="text-xs font-medium text-agent-soft-foreground">Prochaine action recommandée</span>
              </div>
              <h3 className="text-base font-semibold text-foreground">{rec.action}</h3>
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
                    {merged && <p className="text-sm text-foreground/85">{merged}</p>}
                    {extra && item.handoff && (
                      <p className="text-sm text-foreground/85">
                        <span className="text-muted">
                          {label(HANDOFF_REASONS, item.handoff.reason)} :
                        </span>{" "}
                        {summary}
                      </p>
                    )}
                  </>
                );
              })()}
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={RISK_TONE[rec.risk] ?? "neutral"} icon={<ShieldAlert className="size-3" aria-hidden="true" />}>
                  Risque : {label(RISKS, rec.risk).toLowerCase()}
                </Tag>
                {rec.sources.length === 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-soft-foreground">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    Aucune source de la base de connaissances.
                  </span>
                )}
              </div>
            </div>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[13px] font-medium text-foreground outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
                Sources, confiance et contexte
              </summary>
              <div className="grid grid-cols-1 gap-5 border-t border-separator px-5 py-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Eyebrow>Sources utilisées</Eyebrow>
                  {rec.sources.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {rec.sources.map((s) => (
                        <li key={s} className="flex items-start gap-2 text-sm text-foreground">
                          <BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden="true" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Aucune source disponible.</p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Eyebrow>Confiance de l&apos;agent</Eyebrow>
                  <Confidence value={rec.confidence} />
                  {item.draft && (
                    <>
                      <Eyebrow className="pt-2">Exécution</Eyebrow>
                      <div>
                        <Tag tone="warning">{label(EXECUTION, "pending")}</Tag>
                      </div>
                    </>
                  )}
                </div>
                {item.prospect && (
                  <div className="flex flex-col gap-2">
                    <Eyebrow>Contexte commercial</Eyebrow>
                    <div className="flex flex-wrap gap-1.5">
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
      </div>

      {item.kind === "application" && (
        <ApplicationReview item={item} onDone={onDone} />
      )}

      {item.kind === "enrollment" && (
        <EnrollmentReview item={item} onDone={onDone} />
      )}

      {item.handoff && rec && (
        <p>
          <TextLink href={`/conversations?id=${item.conversation_id}`}>
            Répondre dans la conversation →
          </TextLink>
        </p>
      )}

      {item.handoff && !rec && (
        <div className="flex flex-col gap-2 rounded-xl bg-warning-soft px-5 py-4 text-sm text-foreground">
          <p>
            <strong className="font-semibold">Fiche de transfert</strong> —{" "}
            {label(HANDOFF_REASONS, item.handoff.reason)}
          </p>
          <p>{item.handoff.summary}</p>
          <p>
            <TextLink href={`/conversations?id=${item.conversation_id}`}>
              Répondre dans la conversation →
            </TextLink>
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
    <section className="mx-auto flex w-full max-w-[980px] min-w-0 flex-1 flex-col gap-4" aria-label={`Traité : ${name}`}>
      <DetailHead
        name={name}
        chips={
          <>
            <DemoBadge email={item.prospect?.email} />
            <Tag tone={item.decision === "approved" ? "success" : "neutral"}>
              {item.decision === "approved" ? "Validé" : "Refusé"}
              {item.edited ? " (modifié)" : ""}
            </Tag>
            <span className="text-xs text-muted">{formatDate(item.decided_at)}</span>
          </>
        }
        action={
          <LinkButton variant="outline" size="sm" href={`/conversations?id=${item.conversation_id}`}>
            Ouvrir la conversation
          </LinkButton>
        }
      />
      <section className="card card--default gap-3 p-5" aria-label="État d’envoi">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <Eyebrow>État d’envoi</Eyebrow>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <span
                className={`size-2 rounded-full ${
                  EXECUTION_TONE[item.execution] === "success"
                    ? "bg-success"
                    : EXECUTION_TONE[item.execution] === "danger"
                      ? "bg-danger"
                      : EXECUTION_TONE[item.execution] === "accent"
                        ? "bg-accent"
                        : "bg-muted"
                }`}
                aria-hidden="true"
              />
              {label(EXECUTION, item.execution)}
            </h3>
          </div>
          <Btn size="sm" disabled={busy || refreshing} onClick={onChanged}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {refreshing ? "Actualisation…" : "Actualiser l’état"}
          </Btn>
        </div>
        <p className="text-sm text-foreground">{EXECUTION_HELP[item.execution]}</p>
        {item.reason && <p className="text-sm text-foreground">Motif du refus : {item.reason}</p>}
        {item.execution_detail && (
          <p className="rounded-xl bg-surface-secondary px-3 py-2 text-xs text-muted">{item.execution_detail}</p>
        )}
        {canRetry && (
          <div>
            <Btn variant="primary" disabled={busy || refreshing} onClick={retry}>
              {busy ? "Nouvelle tentative…" : "Réessayer l’envoi"}
            </Btn>
          </div>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        {notice && <Notice>{notice}</Notice>}
      </section>
      <section className="draft-panel card card--default gap-0 overflow-hidden p-0" aria-label="Message traité">
        <header className="border-b border-separator px-5 py-3.5">
          <strong className="text-sm font-semibold text-foreground">Message — {label(CHANNELS, item.channel)}</strong>
        </header>
        <div className="px-5 py-4 text-sm/6 whitespace-pre-wrap text-foreground">{item.content}</div>
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

  const placeholderTitle =
    tab === "treated"
      ? "Retrouvez vos décisions"
      : list.loading
        ? "Chargement de votre file…"
        : list.error
          ? "La file est indisponible."
          : items.length
            ? "Faisons avancer vos échanges."
            : kind
              ? "Aucune demande de ce type."
              : "Votre file est à jour.";
  const placeholderText =
    tab === "treated"
      ? "Sélectionnez un message pour consulter la décision et son état d’envoi."
      : list.loading
        ? "Nous récupérons les demandes à examiner."
        : list.error
          ? "Réessayez depuis la liste pour retrouver vos demandes."
          : items.length
            ? "Choisissez une demande à gauche. Vous retrouverez son contexte, la réponse proposée et les éléments pour décider."
            : "Les nouvelles demandes apparaîtront ici. Vous pouvez retrouver les échanges en cours dans les conversations.";

  return (
    <Screen wide className="gap-4">
      <PageHeader
        eyebrow="Travail · Décisions"
        title="À traiter"
        subtitle="Examinez le contexte préparé par l’agent, puis validez la prochaine action."
      />
      {notice && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          className="flex flex-wrap items-center gap-3 rounded-xl bg-success-soft px-5 py-3.5 text-success-soft-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
          role="status"
          aria-label="Résultat de la décision"
        >
          <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col">
            <strong className="text-sm font-semibold">{notice.prospectName}</strong>
            <p className="text-sm">✓ {notice.message}</p>
          </div>
          {notice.treatedId && (
            <LinkButton
              size="sm"
              variant="outline"
              href={`/todo${qs({ tab: "treated", id: notice.treatedId })}`}
            >
              Consulter la décision →
            </LinkButton>
          )}
        </div>
      )}
      {selectedId && (
        <div className="lg:hidden">
          <Btn
            variant="ghost"
            onClick={() =>
              router.replace(
                `/todo${qs({ kind, tab: tab === "treated" ? "treated" : undefined })}`,
                { scroll: false },
              )
            }
          >
            ← Liste des éléments
          </Btn>
        </div>
      )}
      <div className="flex items-start gap-5">
        <aside
          className={`card card--default w-full shrink-0 gap-3 p-3 lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-6rem)] lg:w-[360px] lg:overflow-y-auto ${selectedId ? "hidden" : "flex"}`}
          aria-label="Éléments à traiter"
        >
          <header className="flex items-center gap-2 px-2 pt-1">
            <h2 className="flex-1 text-base font-semibold text-foreground">Votre file de travail</h2>
            <span className="text-[13px] text-muted" aria-label="Éléments en attente">
              <strong className="font-medium text-foreground tabular-nums">{all.data ? total : "—"}</strong> en attente
            </span>
          </header>
          <Segmented
            label="Affichage"
            className="w-full"
            value={tab}
            onChange={(v) => router.replace(v === "treated" ? "/todo?tab=treated" : "/todo", { scroll: false })}
            options={[
              { value: "todo", text: "À traiter" },
              { value: "treated", text: `Traités (24 h) (${treated.data?.total ?? "—"})` },
            ]}
          />
          {tab === "treated" && (
            <>
              <Loading
                loading={treated.loading && !treated.data}
                error={treated.error}
                onRetry={treated.reload}
              />
              {treated.data && treatedItems.length === 0 && (
                <p className="px-2 py-3 text-[13px] text-muted">
                  Rien de traité pour l’instant. Chaque élément traité vient ici
                  avec sa trace : qui a agi, quand, et ce qui est parti.
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {treatedItems.map((t) => {
                  const name = t.prospect
                    ? fullName(t.prospect) || t.prospect.email || "Prospect"
                    : "Prospect";
                  return (
                    <li key={t.id}>
                      <button
                        className={rowClass(t.id === selectedId)}
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
                        <PersonMark name={name} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-baseline gap-2">
                            <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</strong>
                            <span className="shrink-0 text-xs text-muted">{formatDate(t.decided_at)}</span>
                          </span>
                          <span className="flex flex-wrap gap-1.5">
                            <Tag tone={t.decision === "approved" ? "success" : "neutral"}>
                              {t.decision === "approved" ? "Validé" : "Refusé"}
                            </Tag>
                            <Tag tone={EXECUTION_TONE[t.execution] ?? "neutral"}>{label(EXECUTION, t.execution)}</Tag>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="flex flex-wrap gap-1.5 px-1" role="group" aria-label="Type" hidden={tab === "treated"}>
            <FilterChip
              pressed={kind === ""}
              onClick={() => {
                setKind("");
                setOffset(0);
              }}
            >
              Tout ({total})
            </FilterChip>
            {KIND_ORDER.filter(
              (k) => showAllKinds || kind === k || (counts[k] ?? 0) > 0,
            ).map((k) => (
              <FilterChip
                key={k}
                pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setOffset(0);
                }}
              >
                {TASK_LABELS[k]} ({counts[k] ?? 0})
              </FilterChip>
            ))}
            {KIND_ORDER.some((k) => (counts[k] ?? 0) === 0 && kind !== k) && (
              <FilterChip
                pressed={false}
                aria-expanded={showAllKinds}
                onClick={() => setShowAllKinds(!showAllKinds)}
              >
                {showAllKinds ? "Masquer les types vides" : "Autres types"}
              </FilterChip>
            )}
          </div>
          {tab === "todo" && (
            <Loading
              loading={list.loading}
              error={list.error}
              onRetry={list.reload}
              shape="rows"
            />
          )}
          {tab === "todo" && list.data && items.length === 0 && (
            <p className="px-2 py-3 text-[13px] text-muted">Rien à traiter pour le moment.</p>
          )}
          <ul className="flex flex-col gap-0.5" hidden={tab === "treated"}>
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
              <div className="flex items-center justify-between gap-2 border-t border-separator px-1 pt-3">
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={offset === 0 || list.loading}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Éléments précédents
                </Btn>
                <span className="text-xs text-muted tabular-nums">
                  {offset + 1}–{Math.min(offset + 50, list.data.total)} /{" "}
                  {list.data.total}
                </span>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={offset + 50 >= list.data.total || list.loading}
                  onClick={() => setOffset(offset + 50)}
                >
                  Éléments suivants
                </Btn>
              </div>
            )}
        </aside>
        <div className={`min-w-0 flex-1 ${selectedId ? "flex" : "hidden lg:flex"}`}>
          {tab === "treated" && selectedTreated ? (
            <TreatedDetail
              key={selectedTreated.id}
              item={selectedTreated}
              onChanged={treated.reload}
              refreshing={treated.loading}
            />
          ) : tab === "treated" && selectedId ? (
            <section
              className="card card--default flex-1 gap-4 p-6"
              aria-label="Décision recherchée"
            >
              <Loading
                loading={treated.loading}
                error={treated.error}
                onRetry={treated.reload}
              />
              {!treated.loading && !treated.error && treated.data && (
                <div className="flex flex-col items-start gap-3">
                  <h2 className="text-lg font-semibold text-foreground">Cette décision n’est pas dans la liste.</h2>
                  <p className="text-sm text-muted">
                    Les décisions affichées couvrent les dernières 24 heures.
                    Retrouvez l’échange dans les conversations ou actualisez la liste.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Btn onClick={treated.reload}>Actualiser les décisions</Btn>
                    <LinkButton variant="outline" href="/conversations">
                      Consulter les conversations
                    </LinkButton>
                  </div>
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
            <section className="card card--default flex-1 gap-4 p-6">
              <Loading
                loading={direct.loading}
                error={direct.error}
                onRetry={direct.reload}
              />
              {direct.error?.status === 404 && (
                <TextLink href="/conversations">Consulter les conversations</TextLink>
              )}
            </section>
          ) : (
            <section className="card card--default flex-1 p-0">
              <EmptyPanel
                icon={tab === "treated" ? History : ListChecks}
                title={placeholderTitle}
                description={
                  <>
                    <Eyebrow className="mb-2 block">Un regard humain, au bon moment</Eyebrow>
                    {placeholderText}
                  </>
                }
                action={
                  <>
                    {tab === "todo" && items[0] && (
                      <Btn
                        variant="primary"
                        onClick={() =>
                          router.replace(`/todo${qs({ kind, id: items[0].id })}`, {
                            scroll: false,
                          })
                        }
                      >
                        Examiner la première demande →
                      </Btn>
                    )}
                    {tab === "todo" && !list.loading && !list.error && !items.length && (
                      <LinkButton variant="outline" href="/conversations">
                        Voir les conversations
                      </LinkButton>
                    )}
                  </>
                }
              />
            </section>
          )}
        </div>
      </div>
    </Screen>
  );
}

export default function TodoPageRoute() {
  return (
    <Suspense fallback={<Skeleton shape="rows" />}>
      <Todo />
    </Suspense>
  );
}
