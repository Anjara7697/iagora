"use client";

import { Alert, Avatar, Chip } from "@heroui/react";
import { ArrowRight, CalendarClock, CircleCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { AppointmentStatus, MeetingLink, timeFormats } from "@/components/appointments/shared";
import { Collapse } from "@/components/ds/collapse";
import { LinkButton, TextLink } from "@/components/ds/controls";
import { EmptyText, ErrorState, Eyebrow, PageHeader, Screen, Section, cx, initialsOf } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { LevelBadge, Loading } from "@/components/ds/ui";
import { qs } from "@/lib/api";
import { PRIORITIES, STAGES, firstNameOf, formatDate, fullName, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Appointment, DashboardSummary, Page, TodoItem } from "@/lib/types";

type TodoCounts = Page<TodoItem> & { counts: Record<string, number> };

/** Répartition de la file sous la prochaine action (singulier, pluriel), chaque famille ouvre la file filtrée. */
const BUCKETS = [
  { kind: "validation", one: "validation", many: "validations" },
  { kind: "escalation", one: "escalade", many: "escalades" },
  { kind: "kb_gap", one: "question sans réponse", many: "questions sans réponse" },
  { kind: "incident", one: "incident", many: "incidents" },
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

/** Bloc de la page avec son apparition en fondu (règle 9). */
const rise = (rank: number, className?: string) => ({
  className: cx(reveal(rank).className, className),
  style: reveal(rank).style,
});

/**
 * Aujourd'hui, page d'orientation (règle 27) : la prochaine action et la répartition de la file, les rendez-vous et
 * les prospects à fort signal côte à côte, l'activité de l'agent en une ligne, les relances repliées. Le nombre
 * d'éléments à traiter est dans la barre du haut ; l'entonnoir est dans le Tableau de bord (règle 28).
 */
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
  // Familles présentes dans la file ; les premiers contacts sont des brouillons à relire comme les validations.
  const buckets = BUCKETS.map((b) => {
    const firstContacts = b.kind === "validation" ? (counts.first_contact ?? 0) : 0;
    const count = (counts[b.kind] ?? 0) + firstContacts;
    return { ...b, count, href: firstContacts ? "/todo" : `/todo?kind=${b.kind}` };
  }).filter((b) => b.count > 0);

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
        // La date du jour ; rien tant que le fuseau n'est pas connu (règle 15).
        subtitle={today && <span className="first-letter:uppercase">{today.replace(/ \d{4}$/, "")}</span>}
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
              <h2 className="type-title-sm font-semibold text-foreground">
                {next ? TASK_LABELS[next.kind] : waiting > 0 ? "Ouvrir la file" : "Aucune action urgente pour le moment"}
              </h2>
              {next ? (
                <p className="type-body text-muted">
                  <span className="font-medium text-foreground">{next.prospect ? fullName(next.prospect) : next.title}</span>
                  {` · priorité ${label(PRIORITIES, next.priority).toLowerCase()}`}
                  {next.detail ? ` · ${next.detail}` : ""}
                </p>
              ) : (
                <p className="type-body text-muted">
                  {waiting > 0
                    ? "Commencez par l’élément le plus prioritaire."
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
          {/* Répartition de la file en une ligne (UX-08) : chaque famille ouvre la file sur son filtre. */}
          {buckets.length > 0 && (
            <nav
              aria-label="Répartition de la file"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-separator px-5 py-3 type-body-sm sm:px-6"
            >
              {buckets.map((b, i) => (
                <Fragment key={b.kind}>
                  {i > 0 && (
                    <span className="text-muted" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <TextLink href={b.href} className="tabular-nums">
                    {b.count} {b.count > 1 ? b.many : b.one}
                  </TextLink>
                </Fragment>
              ))}
            </nav>
          )}
        </section>
      )}

      <div {...rise(2, "grid grid-cols-1 items-start gap-x-8 gap-y-8 lg:grid-cols-2")}>
        <Section
          label="Prochains rendez-vous"
          title="Prochains rendez-vous"
          action={<TextLink href="/appointments" className="type-body-sm">Tous les rendez-vous</TextLink>}
        >
          <Loading loading={appointments.loading || !timeZone} error={appointments.error} onRetry={appointments.reload} shape="rows" />
          {timeZone && appointments.data?.items.length === 0 && (
            <div className="py-3">
              <EmptyText>Aucun rendez-vous à venir.</EmptyText>
            </div>
          )}
          {timeZone && (
            <ul className="flex flex-col divide-y divide-separator">
              {appointments.data?.items.map((a) => {
                const name = fullName(a.prospect);
                const date = day(a.start_at);
                return (
                  // En mobile, l'heure et le nom sur une ligne, le statut et la visio dessous (UX-05) : rien n'est tronqué.
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <span className="flex w-28 shrink-0 flex-col type-body-sm tabular-nums">
                      <time dateTime={a.start_at} className="font-medium text-foreground">
                        {hour(a.start_at)} – {hour(a.end_at)}
                      </time>
                      <span className="type-caption text-muted first-letter:uppercase">
                        {date === today ? "Aujourd’hui" : date.replace(/ \d{4}$/, "")}
                      </span>
                    </span>
                    <Link
                      href={`/prospects/${a.prospect.id}`}
                      className="min-w-0 flex-1 rounded type-body font-medium break-words text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-2 max-sm:basis-full max-sm:ps-31">
                      <AppointmentStatus status={a.status} />
                      <MeetingLink appointment={a} name={name} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {appointments.data && appointments.data.total > appointments.data.items.length && (
            <p className="border-t border-separator py-3 type-body-sm text-muted">
              + {appointments.data.total - appointments.data.items.length} autre(s) rendez-vous à venir.
            </p>
          )}
        </Section>

        <Section
          label="Prospects à fort signal"
          title="Prospects à fort signal"
          action={<TextLink href="/prospects" className="type-body-sm">Tous les prospects</TextLink>}
        >
          {s && s.hot_prospects.length === 0 && (
            <div className="py-3">
              <EmptyText>Aucun prospect qualifié pour l’instant.</EmptyText>
            </div>
          )}
          <ul className="flex flex-col divide-y divide-separator">
            {s?.hot_prospects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/prospects/${p.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Avatar size="sm" variant="soft" color="accent">
                    <Avatar.Fallback>{initialsOf(p.name)}</Avatar.Fallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="type-body font-medium text-foreground">{p.name}</strong>
                      {p.level && <LevelBadge level={p.level} />}
                    </span>
                    <span className="type-caption text-muted">
                      {label(STAGES, p.stage)} · score {p.total_score}
                      {p.campaign_name ? ` · ${p.campaign_name}` : ""}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {s && (
        <Section
          {...rise(3)}
          label="Activité de l'agent"
          title={
            <span className="flex items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-lg bg-agent text-agent-foreground" aria-hidden="true">
                <Sparkles className="size-3.5" />
              </span>
              Activité de l’agent — dernières {s.activity.hours} h
            </span>
          }
        >
          {/* Une ligne de chiffres (§5.2) ; chaque terme suit son chiffre à l'écran, après lui dans le code. */}
          <dl className="flex flex-wrap gap-x-6 gap-y-2 py-3">
            {[
              [s.activity.prospects_analysed, "prospects analysés"],
              [s.activity.drafts_generated, "brouillons générés"],
              [s.activity.sent_after_validation, "messages envoyés après validation"],
              [s.activity.escalations, "escalades déclenchées"],
              [s.activity.errors, "erreurs techniques"],
            ].map(([value, text]) => (
              <div key={String(text)} className="flex flex-row-reverse items-baseline justify-end gap-1.5">
                <dt className="type-body-sm text-muted">{text}</dt>
                <dd className="type-title-sm font-semibold text-foreground tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <Chip size="sm" variant="soft" color={s.activity.sent_without_validation === 0 ? "success" : "warning"}>
              <Chip.Label>
                {s.activity.sent_without_validation === 0
                  ? "L’agent n’a envoyé aucun message sans validation."
                  : `${s.activity.sent_without_validation} message(s) envoyé(s) sans validation (mode automatique).`}
              </Chip.Label>
            </Chip>
          </div>
        </Section>
      )}

      {s && (
        <section aria-label="Relances programmées" {...rise(3, "border-b border-separator pb-2")}>
          {/* Relances repliées : elles se déroulent seules, on les consulte au besoin. */}
          <Collapse
            title={`Relances programmées (${s.follow_ups_total})`}
            triggerClassName="w-full py-2 type-title-sm font-semibold"
            bodyClassName="flex flex-col"
          >
            {s.follow_ups.length === 0 && <EmptyText>Aucune relance programmée.</EmptyText>}
            <ul className="flex flex-col divide-y divide-separator">
              {s.follow_ups.map((f) => (
                <li key={f.id} className="flex gap-3 py-3">
                  <span
                    className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted"
                    aria-hidden="true"
                  >
                    <CalendarClock className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/prospects/${f.prospect_id}`}
                        className="rounded type-body font-medium text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        {f.prospect_name}
                      </Link>
                      <span className="flex-1" />
                      <span className="type-caption text-muted tabular-nums">{formatDate(f.scheduled_at)}</span>
                    </span>
                    {f.reason && <span className="type-body-sm text-foreground">{f.reason}</span>}
                    <span className="type-caption text-muted">Annulée si le prospect répond, se désinscrit ou est transféré.</span>
                  </span>
                </li>
              ))}
            </ul>
            {s.follow_ups_total > s.follow_ups.length && (
              <p className="border-t border-separator py-3 type-body-sm text-muted">
                + {s.follow_ups_total - s.follow_ups.length} autre(s) relance(s) programmée(s).
              </p>
            )}
          </Collapse>
        </section>
      )}

      {/* L'entonnoir et les chiffres de la période sont dans le Tableau de bord (UX-09, règle 28). */}
      <p {...rise(3, "type-body-sm")}>
        <TextLink href="/dashboard">Entonnoir et chiffres de la période : voir le tableau de bord →</TextLink>
      </p>
    </Screen>
  );
}
