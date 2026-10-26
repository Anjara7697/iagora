"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { DemoBadge, Loading, Pager } from "@/components/ui";
import { qs } from "@/lib/api";
import { APPOINTMENT_STATUS, fullName, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Appointment, Page } from "@/lib/types";

const TONES: Record<string, string> = {
  proposed: "integ-warn", scheduled: "stage-qualified", done: "integ-ok",
  cancelled: "integ-off", no_show: "risk-high",
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
  const date = (value: string) => new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium", timeStyle: "short", timeZone: timeZone ?? "UTC",
  }).format(new Date(value));

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Travail · Suivi des rendez-vous</span>
          <h1>Rendez-vous</h1>
          <p className="muted">Retrouvez les rendez-vous enregistrés et préparez vos échanges.</p>
        </div>
        <button onClick={list.reload} disabled={list.loading}>Actualiser</button>
      </div>
      <div className="view-toolbar">
        <div className="view-switch" role="group" aria-label="Période des rendez-vous">
          <button aria-pressed={when === "upcoming"} onClick={() => update({ when: "upcoming" })}>À venir</button>
          <button aria-pressed={when === "past"} onClick={() => update({ when: "past" })}>Passés</button>
        </div>
        <span className="spacer" />
        <span className="muted" role="status">
          {!list.loading && list.data ? `${list.data.total} rendez-vous` : ""}
        </span>
      </div>
      <form className="filters card" onSubmit={event => event.preventDefault()}>
        <div className="filter-field">
          <label htmlFor="appointment-advisor">Conseiller</label>
          <select id="appointment-advisor" value={advisor} onChange={event => update({ advisor: event.target.value })}>
            <option value="all">Tous les conseillers</option>
            <option value="me">Mes rendez-vous</option>
            {/^\d+$/.test(advisor) && !advisors.data?.items.some(a => String(a.id) === advisor) && (
              <option value={advisor}>Conseiller #{advisor}</option>
            )}
            {advisors.data?.items.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="appointment-status">Statut</label>
          <select id="appointment-status" value={status} onChange={event => update({ status: event.target.value })}>
            <option value="">Tous les statuts</option>
            {Object.entries(APPOINTMENT_STATUS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>
        <label className="inline-field">
          <input type="checkbox" checked={hideDemo} onChange={event => update({ demo: event.target.checked ? "exclude" : "" })} />
          Masquer les prospects fictifs
        </label>
        <button type="button" onClick={() => update({ advisor: "all", status: "", demo: "" })}>Réinitialiser les filtres</button>
      </form>
      {advisors.error && <div className="row">
        <p role="alert" className="error">La liste des conseillers est indisponible.</p>
        <button onClick={advisors.reload}>Réessayer les conseillers</button>
      </div>}
      {advisors.data && advisors.data.total > advisors.data.items.length && (
        <p className="muted">Les {advisors.data.items.length} premiers conseillers sont proposés dans le filtre.</p>
      )}
      <p className="appointment-help">
        {when === "upcoming" ? "Rendez-vous à venir et en cours, du plus proche au plus lointain." : "Rendez-vous passés, du plus récent au plus ancien. Le statut indique le suivi enregistré."}
        {timeZone && <> Horaires : {timeZone}.</>}
      </p>
      <Loading loading={list.loading || !timeZone} error={list.error} onRetry={list.reload} />
      {!list.loading && timeZone && list.data && (
        <>
          {list.data.items.length ? (
            <ul className="appointment-list" aria-label="Rendez-vous enregistrés">
              {list.data.items.map(appointment => {
                const url = meetingLink(appointment.meeting_url);
                return (
                  <li key={appointment.id} className="appointment-card">
                    <div className="appointment-person">
                      <h2><Link href={`/prospects/${appointment.prospect.id}`}>{fullName(appointment.prospect)}</Link></h2>
                      <DemoBadge email={appointment.prospect.email} />
                      <p className="muted">Conseiller : {appointment.advisor_name ?? (appointment.advisor_id ? `Conseiller #${appointment.advisor_id}` : "Non affecté")}</p>
                    </div>
                    <dl className="appointment-dates">
                      <div><dt>Début</dt><dd><time dateTime={appointment.start_at}>{date(appointment.start_at)}</time></dd></div>
                      <div><dt>Fin</dt><dd><time dateTime={appointment.end_at}>{date(appointment.end_at)}</time></dd></div>
                    </dl>
                    <div className="appointment-access">
                      <span className={`badge ${TONES[appointment.status] ?? ""}`}>{label(APPOINTMENT_STATUS, appointment.status)}</span>
                      {url ? <a className="button-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir la visio de ${fullName(appointment.prospect)} dans un nouvel onglet`}>Ouvrir la visio</a>
                        : <span className="muted">Lien visio non disponible</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <section className="empty-state">
              <h2>{list.data.total > 0 ? "Aucun rendez-vous sur cette page" : "Aucun rendez-vous pour cette sélection"}</h2>
              <p className="muted">{list.data.total > 0 ? "La liste a pu évoluer. Revenez à la première page." : "Essayez une autre période ou un autre filtre. Les créneaux proposés dans les conversations ne sont pas des réservations."}</p>
              {offset > 0 && <button onClick={() => update({ offset: "" })}>Revenir à la première page</button>}
            </section>
          )}
          {list.data.items.length > 0 && <Pager total={list.data.total} limit={list.data.limit} offset={list.data.offset} onChange={value => update({ offset: String(value) })} />}
          <p className="muted appointment-help">Les statuts affichés sont ceux enregistrés dans IAGORA. Les modifications faites directement dans l’agenda externe ne sont pas synchronisées ici.</p>
        </>
      )}
    </>
  );
}

export default function AppointmentsPage() {
  return <Suspense fallback={<p className="muted">Chargement…</p>}><Appointments /></Suspense>;
}
