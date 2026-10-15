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

function Kpi({ title, value }: { title: string; value: number }) {
  return (
    <div className="kpi">
      <strong>{value}</strong>
      <span className="muted">{title}</span>
    </div>
  );
}

export default function CampaignsPage() {
  const user = useCurrentUser();
  const [status, setStatus] = useState("");
  const list = useApi<Page<Campaign>>(
    `/campaigns${qs({ status, limit: 100 })}`,
  );
  const overview = useApi<CampaignOverview[]>("/campaigns/overview");
  const figures = new Map((overview.data ?? []).map((o) => [o.campaign_id, o]));
  const items = list.data?.items ?? [];

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Travail · Campagnes</span>
          <h1>Campagnes</h1>
          <p className="muted">
            Chaque campagne vise un ou plusieurs programmes, reçoit ses
            prospects par des sources et suit son propre entonnoir.
          </p>
        </div>
        <span className="spacer" />
        {user?.role === "ADMIN" && (
          <Link className="button-link primary-link" href="/campaigns/new">
            Nouvelle campagne
          </Link>
        )}
      </div>

      <div className="chips" role="group" aria-label="Statut">
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

      <Loading loading={list.loading} error={list.error} onRetry={list.reload} />
      {list.data && items.length === 0 && (
        <p className="card muted">
          Aucune campagne{status ? " dans ce statut" : ""}.{" "}
          {user?.role === "ADMIN" && !status
            ? "Créez la première avec « Nouvelle campagne »."
            : ""}
        </p>
      )}
      <div className="campaign-grid">
        {items.map((c) => {
          const f = figures.get(c.id);
          return (
            <Link
              key={c.id}
              href={`/campaigns/${c.id}`}
              className="campaign-card"
            >
              <div className="row">
                <strong>{c.name}</strong>
                <span className="spacer" />
                <span className={`badge campaign-${c.status}`}>
                  {label(CAMPAIGN_STATUS, c.status)}
                </span>
              </div>
              {c.description && (
                <p className="muted campaign-desc">{c.description}</p>
              )}
              <div className="row">
                {c.targets.map((t) => (
                  <span key={t.code} className="badge">
                    {label(TARGETS, t.code)}
                  </span>
                ))}
                {c.targets.length === 0 && (
                  <span className="muted">Aucun programme</span>
                )}
              </div>
              <p className="muted">
                {c.sources.length} source{c.sources.length > 1 ? "s" : ""}
                {c.start_date || c.end_date
                  ? ` · ${formatDay(c.start_date)} → ${formatDay(c.end_date)}`
                  : ""}
              </p>
              <div className="kpis">
                <Kpi title="Prospects" value={f?.prospects ?? 0} />
                <Kpi title="Chauds" value={f?.hot ?? 0} />
                <Kpi title="Rendez-vous" value={f?.meetings ?? 0} />
                <Kpi title="Convertis" value={f?.converted ?? 0} />
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
