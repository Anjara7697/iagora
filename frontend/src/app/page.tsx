"use client";

import { Alert, Avatar, Chip } from "@heroui/react";
import { ArrowRight, CalendarClock, CircleCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { AppointmentStatus, MeetingLink, timeFormats } from "@/components/appointments/shared";
import { LinkButton } from "@/components/ds/controls";
import {
  BarList,
  EmptyText,
  ErrorState,
  Eyebrow,
  KpiCard,
  PageHeader,
  Panel,
  Screen,
  cx,
  initialsOf,
} from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { LevelBadge, Loading } from "@/components/ui";
import { qs } from "@/lib/api";
import { FUNNEL, PRIORITIES, STAGES, firstNameOf, formatDate, fullName, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Appointment, DashboardSummary, Page, TodoItem } from "@/lib/types";

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
  first_contact: "Relire un premier contact",
  escalation: "Prendre le relais",
  kb_gap: "Compléter une réponse",
  incident: "Résoudre un incident",
  opt_out_check: "Vérifier une opposition",
};

/** Bloc de la page avec son rang dans la cascade d'apparition (règle 9). */
const rise = (rank: number, className?: string) => ({
  className: cx(reveal(rank).className, className),
  style: reveal(rank).style,
});

export default function Home() {
  const user = useCurrentUser();
  const summary = useApi<DashboardSummary>("/dashboard/summary");
  const todo = useApi<TodoCounts>("/todo?limit=1");
  const incidents = useApi<Page<TodoItem>>("/todo?kind=incident&limit=1");
  // Prochains rendez-vous : les siens pour un conseiller, tous sinon.
  const appointments = useApi<Page<Appointment>>(
    user
      ? `/appointments${qs({ when: "upcoming", advisor_id: user.role === "ADVISOR" ? user.id : undefined, limit: 5 })}`
      : null,
  );
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

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
    appointments.reload();
  };
  const { hour, day } = timeFormats(timeZone ?? "UTC");
  const today = timeZone ? day(new Date().toISOString()) : "";

  return (
    <Screen>
      {incident && (
        <Alert status="danger" role="alert" {...rise(0)}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{incident.title}</Alert.Title>
            {incident.detail && <Alert.Description>{incident.detail}</Alert.Description>}
          </Alert.Content>
          <LinkButton size="sm" variant="danger" href={`/todo?id=${encodeURIComponent(incident.id)}`}>
            Diagnostiquer
          </LinkButton>
        </Alert>
      )}

      <PageHeader
        {...rise(0)}
        title={`Bonjour ${firstName}`}
        subtitle={
          // Rien plutôt que « … » tant que la file n'est pas chargée (règle 15).
          waiting !== undefined && (
            <>
              {waiting === 0
                ? "Rien ne vous attend pour le moment"
                : `${waiting} élément${waiting > 1 ? "s" : ""} ${waiting > 1 ? "vous attendent" : "vous attend"}`}
              {s
                ? ` · l’agent a préparé ${s.activity.drafts_generated} brouillon${s.activity.drafts_generated > 1 ? "s" : ""} en ${s.activity.hours} h`
                : ""}
            </>
          )
        }
      />

      {error && <ErrorState message={error.message} onRetry={retry} />}

      {waiting !== undefined && (
        <section
          aria-label="Prochaine action"
          {...rise(1, `overflow-hidden rounded-lg border bg-surface shadow-surface ${waiting > 0 ? "border-accent/25" : "border-success/20"}`)}
        >
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
            <span
              className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg ${waiting > 0 ? "bg-accent-soft text-accent" : "bg-success-soft text-success-soft-foreground"}`}
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
              <LinkButton variant="primary" href={next ? `/todo?id=${encodeURIComponent(next.id)}` : "/todo"}>
                Traiter maintenant
                <ArrowRight className="size-4" aria-hidden="true" />
              </LinkButton>
            )}
          </div>
        </section>
      )}

      <div {...rise(2, "flex flex-col gap-3")}>
        <Eyebrow>Vue rapide de la file</Eyebrow>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {BUCKETS.map((b) => {
            // Les premiers contacts (prospection) sont aussi des brouillons à relire.
            const firstContacts = b.kind === "validation" ? (counts.first_contact ?? 0) : 0;
            return (
              <KpiCard
                key={b.kind}
                href={firstContacts ? "/todo" : `/todo?kind=${b.kind}`}
                label={b.title}
                dot={b.dot}
                value={todo.error ? "—" : (counts[b.kind] ?? 0) + firstContacts}
                loading={!todo.data && !todo.error}
                hint={firstContacts ? `Dont ${firstContacts} premier${firstContacts > 1 ? "s" : ""} contact${firstContacts > 1 ? "s" : ""}` : b.hint}
              />
            );
          })}
        </div>
      </div>

      <div {...rise(3, "grid grid-cols-1 items-start gap-6 lg:grid-cols-2 2xl:grid-cols-3")}>
        <div className="flex flex-col gap-6">
          <Panel
            label="Prochains rendez-vous"
            title="Prochains rendez-vous"
            action={
              <LinkButton size="sm" variant="secondary" href="/appointments">
                Tous les rendez-vous
              </LinkButton>
            }
            bodyClassName="gap-0 px-0 py-0"
          >
            <div className="px-5">
              <Loading loading={appointments.loading || !timeZone} error={appointments.error} onRetry={appointments.reload} shape="rows" />
            </div>
            {timeZone && appointments.data?.items.length === 0 && (
              <div className="px-5 py-3">
                <EmptyText>Aucun rendez-vous à venir.</EmptyText>
              </div>
            )}
            {timeZone &&
              appointments.data?.items.map((a) => {
                const name = fullName(a.prospect);
                const date = day(a.start_at);
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-3 border-b border-separator px-5 py-3.5 last:border-b-0">
                    <span className="flex w-28 shrink-0 flex-col text-[13px] tabular-nums">
                      <time dateTime={a.start_at} className="font-medium text-foreground">
                        {hour(a.start_at)} – {hour(a.end_at)}
                      </time>
                      <span className="text-xs text-muted first-letter:uppercase">
                        {date === today ? "Aujourd’hui" : date.replace(/ \d{4}$/, "")}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link
                        href={`/prospects/${a.prospect.id}`}
                        className="truncate rounded text-sm font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        {name}
                      </Link>
                      <span>
                        <AppointmentStatus status={a.status} />
                      </span>
                    </span>
                    <MeetingLink appointment={a} name={name} />
                  </div>
                );
              })}
            {appointments.data && appointments.data.total > appointments.data.items.length && (
              <p className="border-t border-separator px-5 py-3 text-[13px] text-muted">
                + {appointments.data.total - appointments.data.items.length} autre(s) rendez-vous à venir.
              </p>
            )}
          </Panel>

          <Panel
            label="Prospects à fort signal"
            title="Prospects à fort signal"
            action={
              <LinkButton size="sm" variant="secondary" href="/prospects">
                Tous les prospects
              </LinkButton>
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
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
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
                    <span className="text-xs text-muted tabular-nums">{formatDate(f.scheduled_at)}</span>
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
                    <dd className="text-2xl text-foreground tabular-nums">{value}</dd>
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
                <strong className="font-medium text-foreground">{s.leads}</strong> prospects arrivés sur la
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
