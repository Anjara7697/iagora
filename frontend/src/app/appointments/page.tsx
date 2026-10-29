"use client";

import { CalendarDays, Clock, RefreshCw, RotateCcw, Video, VideoOff } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Btn, Check, ErrorText, Field, NativeSelect, Segmented, Tag, type Tone } from "@/components/ds/controls";
import { EmptyPanel, PageHeader, Screen, initialsOf } from "@/components/ds/layout";
import { DemoBadge, Loading, Pager, Skeleton } from "@/components/ui";
import { qs } from "@/lib/api";
import { APPOINTMENT_STATUS, fullName, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Appointment, Page } from "@/lib/types";

const TONES: Record<string, Tone> = {
  proposed: "warning", scheduled: "accent", done: "success",
  cancelled: "neutral", no_show: "danger",
};

function meetingLink(value: string | null) {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function Appointments() {
  const user = useCurrentUser();
  const params = useSearchParams();
  const when = params.get("when") === "past" ? "past" : "upcoming";
  const requestedStatus = params.get("status") ?? "";
  const status = Object.hasOwn(APPOINTMENT_STATUS, requestedStatus) ? requestedStatus : "";
  const requestedAdvisor = params.get("advisor");
  const advisor = requestedAdvisor === "all" || requestedAdvisor === "me" || /^[1-9]\d*$/.test(requestedAdvisor ?? "")
    ? requestedAdvisor! : user?.role === "ADVISOR" ? "me" : "all";
  const offsetValue = Number(params.get("offset"));
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const hideDemo = params.get("demo") === "exclude";
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const list = useApi<Page<Appointment>>(`/appointments${qs({
    when, status, advisor_id: advisor === "me" ? user?.id : advisor === "all" ? undefined : advisor,
    demo: hideDemo ? "exclude" : "all", limit: 25, offset,
  })}`);
  const advisors = useApi<Page<{ id: number; username: string }>>("/advisors?limit=200");

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(window.location.search);
    next.delete("offset");
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    window.history.pushState(null, "", `/appointments${query ? `?${query}` : ""}`);
  }
  const tz = timeZone ?? "UTC";
  const hour = (value: string) => new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: tz,
  }).format(new Date(value));
  const day = (value: string) => new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz,
  }).format(new Date(value));

  return (
    <Screen className="max-w-[1100px]">
      <PageHeader
        eyebrow="Travail · Suivi des rendez-vous"
        title="Rendez-vous"
        subtitle="Retrouvez les rendez-vous enregistrés et préparez vos échanges."
        actions={
          <Btn variant="outline" onClick={list.reload} disabled={list.loading}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Actualiser
          </Btn>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Période des rendez-vous"
          value={when}
          options={[
            { value: "upcoming", text: "À venir" },
            { value: "past", text: "Passés" },
          ]}
          onChange={(value) => update({ when: value })}
        />
        <span className="flex-1" />
        <span className="font-mono text-[13px] text-muted tabular-nums" role="status">
          {!list.loading && list.data ? `${list.data.total} rendez-vous` : ""}
        </span>
      </div>
      <form
        className="card card--default flex-row flex-wrap items-end gap-4 px-5 py-4"
        aria-label="Filtres des rendez-vous"
        onSubmit={(event) => event.preventDefault()}
      >
        <Field label="Conseiller" className="w-full sm:w-56">
          <NativeSelect id="appointment-advisor" value={advisor} onChange={(event) => update({ advisor: event.target.value })}>
            <option value="all">Tous les conseillers</option>
            <option value="me">Mes rendez-vous</option>
            {/^\d+$/.test(advisor) && !advisors.data?.items.some((a) => String(a.id) === advisor) && (
              <option value={advisor}>Conseiller #{advisor}</option>
            )}
            {advisors.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.username}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Statut" className="w-full sm:w-48">
          <NativeSelect id="appointment-status" value={status} onChange={(event) => update({ status: event.target.value })}>
            <option value="">Tous les statuts</option>
            {Object.entries(APPOINTMENT_STATUS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Check
          className="h-9 items-center"
          checked={hideDemo}
          onChange={(checked) => update({ demo: checked ? "exclude" : "" })}
        >
          Masquer les prospects fictifs
        </Check>
        <span className="flex-1" />
        <Btn variant="ghost" onClick={() => update({ advisor: "all", status: "", demo: "" })}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Réinitialiser les filtres
        </Btn>
      </form>
      {advisors.error && (
        <div className="flex flex-wrap items-center gap-3">
          <ErrorText>La liste des conseillers est indisponible.</ErrorText>
          <Btn size="sm" onClick={advisors.reload}>
            Réessayer les conseillers
          </Btn>
        </div>
      )}
      {advisors.data && advisors.data.total > advisors.data.items.length && (
        <p className="text-[13px] text-muted">
          Les {advisors.data.items.length} premiers conseillers sont proposés dans le filtre.
        </p>
      )}
      <p className="flex items-start gap-2 text-[13px]/[20px] text-muted">
        <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {when === "upcoming"
            ? "Rendez-vous à venir et en cours, du plus proche au plus lointain."
            : "Rendez-vous passés, du plus récent au plus ancien. Le statut indique le suivi enregistré."}
          {timeZone && <> Horaires : {timeZone}.</>}
        </span>
      </p>
      <Loading loading={list.loading || !timeZone} error={list.error} onRetry={list.reload} shape="rows" />
      {!list.loading && timeZone && list.data && (
        <>
          {list.data.items.length ? (
            <ul className="card card--default gap-0 overflow-hidden p-0" aria-label="Rendez-vous enregistrés">
              {list.data.items.map((appointment, index, items) => {
                const url = meetingLink(appointment.meeting_url);
                const dayLabel = day(appointment.start_at);
                const newDay = index === 0 || day(items[index - 1].start_at) !== dayLabel;
                const name = fullName(appointment.prospect);
                const dead = appointment.status === "cancelled" || appointment.status === "no_show";
                return (
                  <Fragment key={appointment.id}>
                    {newDay && (
                      <li className="flex items-center gap-2 border-t border-separator bg-surface-secondary px-5 py-2 text-xs font-medium text-muted first-letter:uppercase first:border-t-0">
                        <CalendarDays className="size-3.5" aria-hidden="true" />
                        <span className="first-letter:uppercase">{dayLabel}</span>
                      </li>
                    )}
                    <li
                      className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-t border-separator px-5 py-4 md:grid-cols-[110px_minmax(0,1.4fr)_minmax(0,1fr)_120px_auto] ${dead ? "opacity-70" : ""}`}
                    >
                      <span className="flex flex-col font-mono text-[13px] tabular-nums">
                        <time dateTime={appointment.start_at} className="text-base font-medium text-foreground">
                          {hour(appointment.start_at)}
                        </time>
                        <span className="text-muted">
                          {"– "}
                          <time dateTime={appointment.end_at}>{hour(appointment.end_at)}</time>
                        </span>
                      </span>
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-xs font-semibold text-foreground"
                          aria-hidden="true"
                        >
                          {initialsOf(name)}
                        </span>
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <Link
                            href={`/prospects/${appointment.prospect.id}`}
                            className="truncate text-sm font-semibold text-foreground hover:text-accent hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                          >
                            {name}
                          </Link>
                          <DemoBadge email={appointment.prospect.email} />
                        </span>
                      </div>
                      <span className="col-span-2 text-[13px] text-muted md:col-span-1">
                        Conseiller :{" "}
                        {appointment.advisor_name ??
                          (appointment.advisor_id ? `Conseiller #${appointment.advisor_id}` : "Non affecté")}
                      </span>
                      <span className="col-span-2 md:col-span-1">
                        <Tag tone={TONES[appointment.status] ?? "neutral"}>
                          {label(APPOINTMENT_STATUS, appointment.status)}
                        </Tag>
                      </span>
                      <span className="col-span-2 md:col-span-1 md:justify-self-end">
                        {url ? (
                          <a
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent-soft px-3 text-[13px] font-medium text-accent-soft-foreground outline-none transition-colors hover:bg-accent-soft-hover focus-visible:ring-2 focus-visible:ring-focus"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Ouvrir la visio de ${name} dans un nouvel onglet`}
                          >
                            <Video className="size-4" aria-hidden="true" />
                            Ouvrir la visio
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
                            <VideoOff className="size-4" aria-hidden="true" />
                            Lien visio non disponible
                          </span>
                        )}
                      </span>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          ) : (
            <section className="card card--default p-0">
              <EmptyPanel
                icon={CalendarDays}
                title={list.data.total > 0 ? "Aucun rendez-vous sur cette page" : "Aucun rendez-vous pour cette sélection"}
                description={
                  list.data.total > 0
                    ? "La liste a pu évoluer. Revenez à la première page."
                    : "Essayez une autre période ou un autre filtre. Les créneaux proposés dans les conversations ne sont pas des réservations."
                }
                action={
                  offset > 0 && (
                    <Btn onClick={() => update({ offset: "" })}>Revenir à la première page</Btn>
                  )
                }
              />
            </section>
          )}
          {list.data.items.length > 0 && (
            <Pager
              total={list.data.total}
              limit={list.data.limit}
              offset={list.data.offset}
              onChange={(value) => update({ offset: String(value) })}
            />
          )}
          <p className="text-xs/[18px] text-muted">
            Les statuts affichés sont ceux enregistrés dans IAGORA. Les modifications faites directement dans l’agenda externe ne sont pas synchronisées ici.
          </p>
        </>
      )}
    </Screen>
  );
}

export default function AppointmentsPage() {
  return <Suspense fallback={<Skeleton shape="rows" />}><Appointments /></Suspense>;
}
