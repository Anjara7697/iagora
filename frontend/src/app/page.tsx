"use client";

import { Avatar, Chip } from "@heroui/react";
import { AlertTriangle, ArrowRight, CalendarClock, CircleCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { firstNameOf, useCurrentUser } from "@/components/AppShell";
import {
  BarList,
  EmptyText,
  ErrorState,
  Eyebrow,
  KpiCard,
  PageHeader,
  Panel,
  Screen,
  initialsOf,
} from "@/components/ds/layout";
import { LevelBadge } from "@/components/ui";
import { FUNNEL, PRIORITIES, STAGES, formatDate, fullName, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { DashboardSummary, Page, TodoItem } from "@/lib/types";

type TodoCounts = Page<TodoItem> & { counts: Record<string, number> };

const BUCKETS = [
  { kind: "validation", title: "Validations", hint: "Brouillons en attente", dot: "bg-warning" },
  { kind: "escalation", title: "Escalades", hint: "Demandes de conseiller", dot: "bg-danger" },
  { kind: "kb_gap", title: "Questions sans réponse", hint: "Réponses bloquées", dot: "bg-agent" },
  { kind: "incident", title: "Incidents", hint: "Réception ou envoi interrompu", dot: "bg-danger" },
] as const;

const TASK_LABELS: Record<TodoItem["kind"], string> = {
  enrollment: "Confirmer une inscription",
  application: "Vérifier une candidature",
  validation: "Relire une réponse",
  escalation: "Prendre le relais",
  kb_gap: "Compléter une réponse",
  incident: "Résoudre un incident",
};

const linkButton =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-default px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-default-hover focus-visible:ring-2 focus-visible:ring-focus";

export default function Home() {
  const user = useCurrentUser();
  const summary = useApi<DashboardSummary>("/dashboard/summary");
  const todo = useApi<TodoCounts>("/todo?limit=1");
  const incidents = useApi<Page<TodoItem>>("/todo?kind=incident&limit=1");

  const counts = todo.data?.counts ?? {};
  const waiting = todo.data?.total;
  const s = summary.data;
  const incident = incidents.data?.items[0];
  const next = todo.data?.items[0];
  const firstName = user?.username ? firstNameOf(user.username) : "";
  const error = summary.error ?? todo.error;
  const retry = () => {
    summary.reload();
    todo.reload();
    incidents.reload();
  };

  return (
    <Screen>
      {incident && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-4 rounded-xl bg-danger-soft px-5 py-4 text-danger-soft-foreground"
        >
          <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <strong className="text-sm font-semibold">{incident.title}</strong>
            {incident.detail && <p className="text-sm">{incident.detail}</p>}
          </div>
          <Link
            className="inline-flex h-9 items-center rounded-xl bg-danger px-4 text-sm font-medium text-danger-foreground outline-none hover:bg-danger-hover focus-visible:ring-2 focus-visible:ring-focus"
            href={`/todo?id=${encodeURIComponent(incident.id)}`}
          >
            Diagnostiquer
          </Link>
        </div>
      )}

      <PageHeader
        eyebrow="Travail · Aujourd’hui"
        title={`Bonjour ${firstName}`}
        subtitle={
          <>
            {waiting === undefined
              ? "…"
              : waiting === 0
                ? "Rien ne vous attend pour le moment"
                : `${waiting} élément${waiting > 1 ? "s" : ""} ${waiting > 1 ? "vous attendent" : "vous attend"}`}
            {s
              ? ` · l’agent a préparé ${s.activity.drafts_generated} brouillon${s.activity.drafts_generated > 1 ? "s" : ""} en ${s.activity.hours} h`
              : ""}
          </>
        }
      />

      {error && <ErrorState message={error.message} onRetry={retry} />}

      {waiting !== undefined && (
        <section
          aria-label="Prochaine action"
          className={`overflow-hidden rounded-2xl border bg-surface shadow-surface ${waiting > 0 ? "border-accent/25" : "border-success/20"}`}
        >
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
            <span
              className={`inline-flex size-11 shrink-0 items-center justify-center rounded-2xl ${waiting > 0 ? "bg-accent-soft text-accent" : "bg-success-soft text-success-soft-foreground"}`}
              aria-hidden="true"
            >
              {waiting > 0 ? <Sparkles className="size-5" /> : <CircleCheck className="size-5" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Eyebrow>{waiting > 0 ? "Prochaine action" : "File à jour"}</Eyebrow>
              <h2 className="text-lg font-semibold text-foreground">
                {next
                  ? TASK_LABELS[next.kind]
                  : waiting > 0
                    ? `${waiting} élément${waiting > 1 ? "s" : ""} à traiter`
                    : "Aucune action urgente pour le moment"}
              </h2>
              {next ? (
                <p className="text-sm text-muted">
                  <span className="font-medium text-foreground">
                    {next.prospect ? fullName(next.prospect) : next.title}
                  </span>
                  {` · priorité ${label(PRIORITIES, next.priority).toLowerCase()}`}
                  {next.detail ? ` · ${next.detail}` : ""}
                </p>
              ) : (
                <p className="text-sm text-muted">
                  {waiting > 0
                    ? "Ouvrez la file pour commencer par l’élément le plus prioritaire."
                    : "L’agent continue de surveiller les nouveaux échanges et incidents."}
                </p>
              )}
            </div>
            {waiting > 0 && (
              <Link
                href={next ? `/todo?id=${encodeURIComponent(next.id)}` : "/todo"}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-foreground outline-none hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-focus"
              >
                Traiter maintenant
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3">
        <Eyebrow>Vue rapide de la file</Eyebrow>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {BUCKETS.map((b) => (
            <KpiCard
              key={b.kind}
              href={`/todo?kind=${b.kind}`}
              label={b.title}
              dot={b.dot}
              value={todo.error ? "—" : (counts[b.kind] ?? (todo.data ? 0 : "…"))}
              hint={b.hint}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <div className="flex flex-col gap-6">
          <Panel
            label="Prospects à fort signal"
            title="Prospects à fort signal"
            action={
              <Link className={linkButton} href="/prospects">
                Tous les prospects
              </Link>
            }
            bodyClassName="gap-1 px-2 py-2"
          >
            {s && s.hot_prospects.length === 0 && (
              <div className="px-3">
                <EmptyText>Aucun prospect qualifié pour l’instant.</EmptyText>
              </div>
            )}
            {s?.hot_prospects.map((p) => (
              <Link
                key={p.id}
                href={`/prospects/${p.id}`}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
              >
                <Avatar size="sm" variant="soft" color="accent">
                  <Avatar.Fallback>{initialsOf(p.name)}</Avatar.Fallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-medium text-foreground">{p.name}</strong>
                    {p.level && <LevelBadge level={p.level} />}
                  </span>
                  <span className="text-xs text-muted">
                    {label(STAGES, p.stage)} · score {p.total_score}
                    {p.campaign_name ? ` · ${p.campaign_name}` : ""}
                  </span>
                </span>
                <ArrowRight className="size-4 text-muted" aria-hidden="true" />
              </Link>
            ))}
          </Panel>

          <Panel label="Relances programmées" title="Relances programmées" bodyClassName="gap-0 px-0 py-0">
            {s && s.follow_ups.length === 0 && (
              <div className="px-5 py-3">
                <EmptyText>Aucune relance programmée.</EmptyText>
              </div>
            )}
            {s?.follow_ups.map((f) => (
              <div key={f.id} className="flex gap-3 border-b border-separator px-5 py-3.5 last:border-b-0">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted" aria-hidden="true">
                  <CalendarClock className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/prospects/${f.prospect_id}`}
                      className="rounded text-sm font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <strong className="font-medium">{f.prospect_name}</strong>
                    </Link>
                    <span className="flex-1" />
                    <span className="font-mono text-xs text-muted tabular-nums">{formatDate(f.scheduled_at)}</span>
                  </span>
                  {f.reason && <span className="text-[13px] text-foreground">{f.reason}</span>}
                  <span className="text-xs text-muted">
                    Annulée si le prospect répond, se désinscrit ou est transféré.
                  </span>
                </span>
              </div>
            ))}
            {s && s.follow_ups_total > s.follow_ups.length && (
              <p className="border-t border-separator px-5 py-3 text-[13px] text-muted">
                + {s.follow_ups_total - s.follow_ups.length} autre(s) relance(s) programmée(s).
              </p>
            )}
          </Panel>
        </div>

        <Panel
          label="Activité de l'agent"
          title={
            <span className="flex items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-lg bg-agent text-agent-foreground" aria-hidden="true">
                <Sparkles className="size-3.5" />
              </span>
              Activité de l’agent — dernières {s?.activity.hours ?? 24} h
            </span>
          }
        >
          {s && (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
                {[
                  [s.activity.prospects_analysed, "prospects analysés"],
                  [s.activity.drafts_generated, "brouillons générés"],
                  [s.activity.sent_after_validation, "messages envoyés après validation"],
                  [s.follow_ups_total, "relances programmées"],
                  [s.activity.escalations, "escalades déclenchées"],
                  [s.activity.errors, "erreurs techniques"],
                ].map(([value, text]) => (
                  <div key={String(text)} className="flex flex-col-reverse gap-1">
                    <dt className="text-[13px]/[18px] text-muted">{text}</dt>
                    <dd className="font-mono text-2xl text-foreground tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 border-t border-separator pt-4">
                <Chip
                  size="sm"
                  variant="soft"
                  color={s.activity.sent_without_validation === 0 ? "success" : "warning"}
                >
                  <Chip.Label>
                    {s.activity.sent_without_validation === 0
                      ? "L’agent n’a envoyé aucun message sans validation."
                      : `${s.activity.sent_without_validation} message(s) envoyé(s) sans validation (mode automatique).`}
                  </Chip.Label>
                </Chip>
              </div>
            </>
          )}
        </Panel>

        <Panel label="Entonnoir" title={`Entonnoir — ${s?.funnel_days ?? 30} derniers jours`} className="lg:col-span-2 2xl:col-span-1">
          {s && s.leads === 0 && <EmptyText>Aucun prospect sur la période.</EmptyText>}
          {s && s.leads > 0 && (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-muted">
                <strong className="font-mono font-medium text-foreground">{s.leads}</strong> prospects arrivés sur la
                période. Répartition par étape actuelle.
              </p>
              <BarList
                rows={FUNNEL.map((step) => ({
                  key: step.title,
                  label: step.title,
                  value: step.stages.reduce((sum, st) => sum + (s.funnel[st] ?? 0), 0),
                }))}
              />
            </div>
          )}
        </Panel>
      </div>
    </Screen>
  );
}
