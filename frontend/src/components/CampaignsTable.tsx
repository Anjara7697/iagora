"use client";

import type { ReactNode } from "react";
import { Tag, type Tone } from "@/components/ds/controls";
import { reveal } from "@/components/ds/motion";
import { SourceAvatars } from "@/components/ds/SourceAvatars";
import { DataTable, Table } from "@/components/ds/table";
import { CAMPAIGN_STATUS, TARGETS, formatPeriod, label } from "@/lib/labels";
import type { Campaign, CampaignOverview } from "@/lib/types";

const STATUS_TONE: Record<string, Tone> = { active: "success", draft: "warning", inactive: "neutral" };

/** Tableau des campagnes : une ligne par campagne (ouvre sa fiche), sources en pile d'avatars, chiffres du parcours. */
export default function CampaignsTable({
  campaigns,
  figures,
  isLoading,
  emptyState,
  footer,
  linkSuffix = "",
}: {
  campaigns: Campaign[];
  figures: Map<number, CampaignOverview>;
  isLoading?: boolean;
  emptyState?: ReactNode;
  footer?: ReactNode;
  /** Ajouté au lien de chaque ligne (ex. `?from=…` pour revenir à la liste filtrée). */
  linkSuffix?: string;
}) {
  return (
    <DataTable
      {...reveal(6)}
      label="Liste des campagnes"
      minWidth={820}
      isLoading={isLoading}
      loadingLabel="Chargement des campagnes…"
      emptyState={emptyState}
      footer={footer}
      columns={[
        { id: "campaign", label: "Campagne", className: "min-w-[240px]" },
        { id: "status", label: "Statut" },
        { id: "sources", label: "Sources" },
        { id: "leads", label: "Leads", className: "text-right" },
        { id: "qualified", label: "Qualifiés", className: "text-right" },
        { id: "converted", label: "Inscrits", className: "text-right" },
      ]}
    >
      {campaigns.map((c, i) => {
        const f = figures.get(c.id);
        const row = reveal(7 + i, 40);
        return (
          <Table.Row key={c.id} id={c.id} href={`/campaigns/${c.id}${linkSuffix}`} className={row.className} style={row.style}>
            <Table.Cell>
              <span className="flex min-w-0 flex-col gap-0.5">
                <strong className="text-sm font-semibold text-foreground">{c.name}</strong>
                <span className="text-xs text-muted">Responsable : {c.responsible_advisor_name ?? "Non affecté"}</span>
                <span className="text-xs text-muted">
                  {c.targets.map((t) => label(TARGETS, t.code)).join(", ") || "Aucun programme"}
                  {c.start_date || c.end_date ? ` · ${formatPeriod(c.start_date, c.end_date)}` : ""}
                </span>
              </span>
            </Table.Cell>
            <Table.Cell>
              <Tag tone={STATUS_TONE[c.status] ?? "neutral"}>{label(CAMPAIGN_STATUS, c.status)}</Tag>
            </Table.Cell>
            <Table.Cell>
              <span className="flex items-center gap-2">
                <SourceAvatars sources={c.sources} />
                <span className="text-[13px] text-muted">
                  {c.sources.length} source{c.sources.length > 1 ? "s" : ""}
                </span>
              </span>
            </Table.Cell>
            <Table.Cell className="text-right tabular-nums">{f?.prospects ?? 0}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{f?.qualified ?? 0}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{f?.converted ?? 0}</Table.Cell>
          </Table.Row>
        );
      })}
    </DataTable>
  );
}
