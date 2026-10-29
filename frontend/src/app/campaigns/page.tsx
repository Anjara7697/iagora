"use client";

import Link from "next/link";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Loading } from "@/components/ui";
import { CAMPAIGN_STATUS, TARGETS, formatDay, label } from "@/lib/labels";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Campaign, CampaignOverview, Page } from "@/lib/types";

const FILTERS = [
  { value: "", text: "Toutes" },
  { value: "active", text: "Actives" },
  { value: "draft", text: "Brouillons" },
  { value: "inactive", text: "Inactives" },
];

const PLATFORM_MARK: Record<string, string> = {
  linkedin: "in",
  meta: "f",
  web: "www",
  email: "@",
};

export default function CampaignsPage() {
  const user = useCurrentUser();
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const list = useApi<Page<Campaign>>(
    `/campaigns${qs({ status, advisor_id: mine ? user?.id : undefined, limit: 100 })}`,
    {
      keepPrevious: true,
    },
  );
  const everything = useApi<Page<Campaign>>("/campaigns?limit=100");
  const overview = useApi<CampaignOverview[]>("/campaigns/overview");
  const figures = new Map((overview.data ?? []).map((o) => [o.campaign_id, o]));
  const items = list.data?.items ?? [];

  const all = everything.data?.items ?? [];
  const totals = (overview.data ?? []).reduce(
    (t, o) => ({
      leads: t.leads + o.prospects,
      qualified: t.qualified + (o.qualified ?? 0),
      converted: t.converted + o.converted,
    }),
    { leads: 0, qualified: 0, converted: 0 },
  );
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const maxLeads = Math.max(
    1,
    ...(overview.data ?? []).map((o) => o.prospects),
  );
  const kpiReady = !!everything.data && !!overview.data;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Pilotage · Campagnes</span>
          <h1>Campagnes</h1>
          <p className="muted">
            Une campagne regroupe une ou plusieurs sources ; l’agent répond
            individuellement aux personnes qu’elle amène.
          </p>
        </div>
        <span className="spacer" />
        {user?.role === "ADMIN" && (
          <Link className="button-link primary-link" href="/campaigns/new">
            Nouvelle campagne
          </Link>
        )}
      </div>

      <section className="kpi-strip" aria-label="Chiffres clés">
        <div>
          <span className="eyebrow">Campagnes actives</span>
          <strong>
            {kpiReady
              ? `${all.filter((c) => c.status === "active").length} / ${all.length}`
              : "…"}
          </strong>
          <span className="muted">
            {kpiReady
              ? `${all.filter((c) => c.status === "draft").length} brouillon(s)`
              : ""}
          </span>
        </div>
        <div>
          <span className="eyebrow">Leads</span>
          <strong>{kpiReady ? totals.leads : "…"}</strong>
          <span className="muted">au total, prospects fictifs exclus</span>
        </div>
        <div>
          <span className="eyebrow">Taux de qualification</span>
          <strong>
            {kpiReady ? `${pct(totals.qualified, totals.leads)} %` : "…"}
          </strong>
          <span className="muted">
            {kpiReady ? `${totals.qualified} qualifié(s)` : ""}
          </span>
        </div>
        <div>
          <span className="eyebrow">Inscrits</span>
          <strong>{kpiReady ? totals.converted : "…"}</strong>
          <span className="muted">
            {kpiReady
              ? `${pct(totals.converted, totals.leads)} % des leads`
              : ""}
          </span>
        </div>
      </section>
      {overview.error && (
        <p className="error" role="alert">
          Chiffres indisponibles : {overview.error.message}{" "}
          <button onClick={overview.reload}>Réessayer</button>
        </p>
      )}

      <div className="chips" role="group" aria-label="Statut">
        {user && user.role !== "VIEWER" && (
          <button aria-pressed={mine} onClick={() => setMine(!mine)}>
            Mes campagnes
          </button>
        )}
        {FILTERS.map((f) => (
          <button
            key={f.value}
            aria-pressed={status === f.value}
            onClick={() => setStatus(f.value)}
          >
            {f.text}
          </button>
        ))}
      </div>

      <Loading
        loading={list.loading && !list.data}
        error={list.error}
        onRetry={list.reload}
        shape="rows"
      />
      {list.data && items.length === 0 && (
        <p className="ui-card muted">
          Aucune campagne{status ? " dans ce statut" : ""}.{" "}
          {user?.role === "ADMIN" && !status
            ? "Créez la première avec « Nouvelle campagne »."
            : ""}
        </p>
      )}
      {items.length > 0 && (
        <div
          className="ui-card campaign-table"
          role="table"
          aria-label="Liste des campagnes"
        >
          <div className="campaign-row head" aria-hidden="true">
            <span>Campagne</span>
            <span>Statut</span>
            <span>Sources</span>
            <span>Leads · Qualifiés · Inscrits</span>
            <span />
          </div>
          {items.map((c) => {
            const f = figures.get(c.id);
            const leads = f?.prospects ?? 0;
            const qualified = f?.qualified ?? 0;
            const converted = f?.converted ?? 0;
            return (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="campaign-row"
              >
                <span>
                  <strong>{c.name}</strong>
                  <span className="muted campaign-sub">
                    Responsable : {c.responsible_advisor_name ?? "Non affecté"}
                  </span>
                  <span className="muted campaign-sub">
                    {c.targets.map((t) => label(TARGETS, t.code)).join(", ") ||
                      "Aucun programme"}
                    {c.start_date || c.end_date
                      ? ` · ${formatDay(c.start_date)} → ${formatDay(c.end_date)}`
                      : ""}
                  </span>
                </span>
                <span>
                  <span className={`ui-badge campaign-${c.status}`}>
                    {label(CAMPAIGN_STATUS, c.status)}
                  </span>
                </span>
                <span className="row">
                  {c.sources.slice(0, 3).map((s) => (
                    <span
                      key={s.id}
                      className="source-mark"
                      aria-hidden="true"
                      title={s.name}
                    >
                      {PLATFORM_MARK[s.platform ?? ""] ?? "•"}
                    </span>
                  ))}
                  <span className="muted">
                    {c.sources.length} source{c.sources.length > 1 ? "s" : ""}
                  </span>
                </span>
                <span className="campaign-bar">
                  <span className="funnel-bar" aria-hidden="true">
                    <span
                      className="fb-leads"
                      style={{ width: `${(leads / maxLeads) * 100}%` }}
                    >
                      <span
                        className="fb-qualified"
                        style={{ width: `${pct(qualified, leads)}%` }}
                      >
                        <span
                          className="fb-converted"
                          style={{ width: `${pct(converted, qualified)}%` }}
                        />
                      </span>
                    </span>
                  </span>
                  <strong>
                    {leads} · {qualified} · {converted}
                  </strong>
                </span>
                <span aria-hidden="true" className="muted">
                  ›
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
