"use client";

import { Spinner } from "@heroui/react";
import type { ReactNode } from "react";
import { Tag, type Tone } from "@/components/ds/controls";
import { reveal } from "@/components/ds/motion";
import { SourceAvatars } from "@/components/ds/SourceAvatars";
import { CompactList, CompactRow, DataTable, Table } from "@/components/ds/table";
import { NARROW, useMediaQuery } from "@/lib/useMediaQuery";
import { CAMPAIGN_STATUS, TARGETS, formatPeriod, label } from "@/lib/labels";
import type { Campaign, CampaignOverview } from "@/lib/types";

const STATUS_TONE: Record<string, Tone> = { active: "success", draft: "warning", inactive: "neutral" };

/**
 * Tableau des campagnes : une ligne par campagne (ouvre sa fiche), sources en pile d'avatars, chiffres du parcours.
 * Sous 640 px, lignes à deux niveaux : le statut et les chiffres restent lisibles sans défilement horizontal.
 */
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
  const narrow = useMediaQuery(NARROW);
  const status = (c: Campaign) => <Tag tone={STATUS_TONE[c.status] ?? "neutral"}>{label(CAMPAIGN_STATUS, c.status)}</Tag>;
  const programme = (c: Campaign) =>
    `${c.targets.map((t) => label(TARGETS, t.code)).join(", ") || "Aucun programme"}${
      c.start_date || c.end_date ? ` · ${formatPeriod(c.start_date, c.end_date)}` : ""
    }`;
  // Sous 640 px : nom et statut, puis responsable, programme et chiffres du parcours (règle 4, UX-04).
  if (narrow)
    return (
      <div {...reveal(6)} className={`flex flex-col gap-3 ${reveal(6).className}`}>
        {isLoading ? (
          <p className="flex items-center justify-center gap-2 py-8 type-body text-muted" role="status">
            <Spinner size="sm" />
            Chargement des campagnes…
          </p>
        ) : campaigns.length ? (
          <CompactList label="Liste des campagnes">
            {campaigns.map((c) => {
              const f = figures.get(c.id);
              return (
                <CompactRow key={c.id} href={`/campaigns/${c.id}${linkSuffix}`} title={c.name} aside={status(c)}>
                  <span className="type-caption text-muted">Responsable : {c.responsible_advisor_name ?? "Non affecté"}</span>
                  <span className="type-caption text-muted">{programme(c)}</span>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 type-body-sm">
                    {(
                      [
                        ["Leads", f?.prospects ?? 0],
                        ["Qualifiés", f?.qualified ?? 0],
                        ["Inscrits", f?.converted ?? 0],
                        ["Sources", c.sources.length],
                      ] as const
                    ).map(([term, value]) => (
                      <div key={term} className="flex gap-1">
                        <dt className="text-muted">{term}</dt>
                        <dd className="font-medium text-foreground tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </CompactRow>
              );
            })}
          </CompactList>
        ) : (
          emptyState
        )}
        {footer}
      </div>
    );
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
                <strong className="type-body font-semibold text-foreground">{c.name}</strong>
                <span className="type-caption text-muted">Responsable : {c.responsible_advisor_name ?? "Non affecté"}</span>
                <span className="type-caption text-muted">{programme(c)}</span>
              </span>
            </Table.Cell>
            <Table.Cell>
              {status(c)}
            </Table.Cell>
            <Table.Cell>
              <span className="flex items-center gap-2">
                <SourceAvatars sources={c.sources} />
                <span className="type-body-sm text-muted">
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
