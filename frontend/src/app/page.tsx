"use client";

import Link from "next/link";
import { firstNameOf, useCurrentUser } from "@/components/AppShell";
import { LevelBadge, Loading } from "@/components/ui";
import { FUNNEL, STAGES, formatDate, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { DashboardSummary, Page, TodoItem } from "@/lib/types";

type TodoCounts = Page<TodoItem> & { counts: Record<string, number> };

const BUCKETS = [
  {
    kind: "validation",
    title: "Validations",
    hint: "Brouillons en attente",
    tone: "warn",
  },
  {
    kind: "escalation",
    title: "Escalades",
    hint: "Demandes de conseiller",
    tone: "err",
  },
  {
    kind: "kb_gap",
    title: "Questions sans réponse",
    hint: "Réponses bloquées",
    tone: "ai",
  },
  {
    kind: "incident",
    title: "Incidents",
    hint: "Réception ou envoi interrompu",
    tone: "err",
  },
] as const;

function Card({
  title,
  action,
  children,
  label: aria,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section className="ui-card today-card" aria-label={aria}>
      <header className="today-card-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export default function Home() {
  const user = useCurrentUser();
  const summary = useApi<DashboardSummary>("/dashboard/summary");
  const todo = useApi<TodoCounts>("/todo?limit=1");
  const incidents = useApi<Page<TodoItem>>("/todo?kind=incident&limit=1");

  const counts = todo.data?.counts ?? {};
  const waiting = todo.data?.total;
  const s = summary.data;
  const incident = incidents.data?.items[0];
  const firstName = user?.username ? firstNameOf(user.username) : "";
  const retry = () => {
    summary.reload();
    todo.reload();
    incidents.reload();
  };

  return (
    <>
      {incident && (
        <div className="today-alert" role="alert">
          <div>
            <strong>{incident.title}</strong>
            {incident.detail && <p>{incident.detail}</p>}
          </div>
          <Link
            className="button-link danger-link"
            href={`/todo?id=${encodeURIComponent(incident.id)}`}
          >
            Diagnostiquer
          </Link>
        </div>
      )}

      <h1 className="today-hello">Bonjour {firstName}</h1>
      <p className="today-line">
        {waiting === undefined
          ? "…"
          : waiting === 0
            ? "Rien ne vous attend pour le moment"
            : `${waiting} élément${waiting > 1 ? "s" : ""} ${waiting > 1 ? "vous attendent" : "vous attend"}`}
        {s
          ? ` · l’agent a préparé ${s.activity.drafts_generated} brouillon${s.activity.drafts_generated > 1 ? "s" : ""} en ${s.activity.hours} h`
          : ""}
      </p>
      <Loading
        loading={false}
        error={summary.error ?? todo.error}
        onRetry={retry}
      />

      <div className="bucket-grid">
        {BUCKETS.map((b) => (
          <Link
            key={b.kind}
            href={`/todo?kind=${b.kind}`}
            className="ui-card bucket"
          >
            <span className="bucket-title">
              <span className={`dot tone-${b.tone}`} aria-hidden="true" />
              {b.title}
            </span>
            <span className="bucket-value">
              {todo.error ? "—" : (counts[b.kind] ?? (todo.data ? 0 : "…"))}
            </span>
            <span className="muted">{b.hint}</span>
          </Link>
        ))}
      </div>

      <div className="today-grid">
        <div className="today-col">
          <Card
            label="Prospects à fort signal"
            title="Prospects à fort signal"
            action={
              <Link className="button-link" href="/prospects">
                Tous les prospects
              </Link>
            }
          >
            {s && s.hot_prospects.length === 0 && (
              <p className="muted today-empty">
                Aucun prospect qualifié pour l’instant.
              </p>
            )}
            {s?.hot_prospects.map((p) => (
              <Link
                key={p.id}
                href={`/prospects/${p.id}`}
                className="today-row"
              >
                <span className="prospect-avatar" aria-hidden="true">
                  {p.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="today-row-main">
                  <span className="row">
                    <strong>{p.name}</strong>
                    {p.level && (
                      <LevelBadge level={p.level} />
                    )}
                  </span>
                  <span className="muted today-row-meta">
                    {label(STAGES, p.stage)} · score {p.total_score}
                    {p.campaign_name ? ` · ${p.campaign_name}` : ""}
                  </span>
                </span>
              </Link>
            ))}
          </Card>
          <Card label="Relances programmées" title="Relances programmées">
            {s && s.follow_ups.length === 0 && (
              <p className="muted today-empty">Aucune relance programmée.</p>
            )}
            {s?.follow_ups.map((f) => (
              <div key={f.id} className="today-row followup">
                <span className="today-row-main">
                  <span className="row">
                    <Link href={`/prospects/${f.prospect_id}`}>
                      <strong>{f.prospect_name}</strong>
                    </Link>
                    <span className="spacer" />
                    <span className="time">{formatDate(f.scheduled_at)}</span>
                  </span>
                  {f.reason && (
                    <span className="muted today-row-meta">{f.reason}</span>
                  )}
                  <span className="muted today-row-meta">
                    Annulée si le prospect répond, se désinscrit ou est
                    transféré.
                  </span>
                </span>
              </div>
            ))}
            {s && s.follow_ups_total > s.follow_ups.length && (
              <p className="muted today-note">
                + {s.follow_ups_total - s.follow_ups.length} autre(s) relance(s)
                programmée(s).
              </p>
            )}
          </Card>
        </div>
        <Card
          label="Activité de l'agent"
          title={`Activité de l’agent — dernières ${s?.activity.hours ?? 24} h`}
        >
          {s && (
            <>
              <dl className="today-stats">
                {[
                  [s.activity.prospects_analysed, "prospects analysés"],
                  [s.activity.drafts_generated, "brouillons générés"],
                  [
                    s.activity.sent_after_validation,
                    "messages envoyés après validation",
                  ],
                  [s.follow_ups_total, "relances programmées"],
                  [s.activity.escalations, "escalades déclenchées"],
                  [s.activity.errors, "erreurs techniques"],
                ].map(([value, text]) => (
                  <div key={String(text)}>
                    <dd>{value}</dd>
                    <dt className="muted">{text}</dt>
                  </div>
                ))}
              </dl>
              <p className="today-note">
                {s.activity.sent_without_validation === 0
                  ? "L’agent n’a envoyé aucun message sans validation."
                  : `${s.activity.sent_without_validation} message(s) envoyé(s) sans validation (mode automatique).`}
              </p>
            </>
          )}
        </Card>

        <Card
          label="Entonnoir"
          title={`Entonnoir — ${s?.funnel_days ?? 30} derniers jours`}
        >
          {s && s.leads === 0 && (
            <p className="muted today-empty">Aucun prospect sur la période.</p>
          )}
          {s && s.leads > 0 && (
            <>
              <p className="today-note">
                <strong>{s.leads}</strong> prospects arrivés sur la période.
                <br />
                Répartition par étape actuelle.
              </p>
              {(() => {
                const rows = FUNNEL.map((step) => ({
                  title: step.title,
                  value: step.stages.reduce(
                    (sum, st) => sum + (s.funnel[st] ?? 0),
                    0,
                  ),
                }));
                const max = Math.max(1, ...rows.map((r) => r.value));
                return rows.map((r) => (
                  <div className="bar-row" key={r.title}>
                    <span>{r.title}</span>
                    <div className="bar" aria-hidden="true">
                      <div
                        style={{
                          width: `${Math.round((r.value / max) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="mono">{r.value}</span>
                  </div>
                ));
              })()}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
