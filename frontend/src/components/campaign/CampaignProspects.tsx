"use client";

import { SelectBox, Tag } from "@/components/ds/controls";
import { EmptyText, initialsOf } from "@/components/ds/layout";
import { DataTable, Table, TablePagination } from "@/components/ds/table";
import { DemoBadge, ScoreBadge, StageBadge } from "@/components/ui";
import { qs } from "@/lib/api";
import { CONSENT, STAGES, fullName, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type { Campaign, Page, Prospect } from "@/lib/types";

const PAGE_SIZE = 6;

/**
 * Prospects rattachés à la campagne : nom, étape dans CETTE campagne, score, consentement ; la ligne ouvre la fiche
 * du prospect avec `from=returnHref` (retour à cet onglet, à cette étape et à cette page). Étape et page sont pilotées
 * par la fiche (URL).
 */
export default function CampaignProspects({
  campaign,
  stage,
  page,
  onChange,
  returnHref,
}: {
  campaign: Campaign;
  stage: string;
  page: number;
  onChange: (next: { stage: string; page: number }) => void;
  returnHref: string;
}) {
  const list = useApi<Page<Prospect>>(
    `/prospects${qs({ campaign_id: campaign.id, stage, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })}`,
    { keepPrevious: true },
  );
  // Total de la campagne, pour « N sur M » quand une étape est choisie.
  const all = useApi<Page<Prospect>>(stage ? `/prospects${qs({ campaign_id: campaign.id, limit: 1 })}` : null);
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  return (
    <section aria-label="Prospects de la campagne" className="flex flex-col gap-3">
      {/* Barre au-dessus du tableau (règle des parcours) : filtre à gauche, compteur à droite. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <label id="campaign-stage-label" htmlFor="campaign-stage" className="text-[13px] text-muted">
            Étape
          </label>
          <SelectBox
            id="campaign-stage"
            aria-labelledby="campaign-stage-label"
            fullWidth={false}
            className="w-44"
            value={stage}
            onChange={(e) => onChange({ stage: e.target.value, page: 1 })}
          >
            <option value="">Toutes</option>
            {Object.entries(STAGES).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </SelectBox>
        </span>
        <span className="text-[13px] text-muted tabular-nums" role="status">
          {list.data
            ? `${total} prospect${total > 1 ? "s" : ""}${stage ? `${all.data ? ` sur ${all.data.total}` : ""} à l’étape « ${label(STAGES, stage)} »` : ""}`
            : ""}
        </span>
      </div>
      {list.error ? (
        <EmptyText>{list.error.message}</EmptyText>
      ) : (
        <DataTable
          label="Prospects de la campagne"
          minWidth={640}
          isLoading={list.loading && !list.data}
          loadingLabel="Chargement des prospects…"
          emptyState={
            <EmptyText>
              {stage ? "Aucun prospect à cette étape." : "Aucun prospect pour l’instant. Ils arrivent par les sources de la campagne."}
            </EmptyText>
          }
          footer={total > PAGE_SIZE ? <TablePagination total={total} pageSize={PAGE_SIZE} page={page} onChange={(next) => onChange({ stage, page: next })} /> : undefined}
          columns={[
            { id: "prospect", label: "Prospect" },
            { id: "stage", label: "Étape" },
            { id: "score", label: "Score" },
            { id: "consent", label: "Consentement" },
          ]}
        >
          {items.map((p) => {
            const m = p.campaigns
              .filter((c) => c.campaign_id === campaign.id)
              .sort((a, b) => new Date(b.last_seen_at ?? 0).getTime() - new Date(a.last_seen_at ?? 0).getTime() || b.id - a.id)[0];
            const name = fullName(p) || p.email || `#${p.id}`;
            return (
              <Table.Row key={p.id} id={p.id} href={`/prospects/${p.id}?from=${encodeURIComponent(returnHref)}`}>
                <Table.Cell>
                  <span className="flex items-center gap-3">
                    <span
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-xs font-semibold text-foreground"
                      aria-hidden="true"
                    >
                      {initialsOf(name)}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2 font-medium text-foreground">
                        {name}
                        <DemoBadge email={p.email} />
                      </span>
                      {p.email && <span className="text-xs text-muted">{p.email}</span>}
                    </span>
                  </span>
                </Table.Cell>
                <Table.Cell>{m ? <StageBadge stage={m.conversion_stage} /> : "-"}</Table.Cell>
                <Table.Cell>{m ? <ScoreBadge total={m.total_score} level={m.interest_status} /> : "-"}</Table.Cell>
                <Table.Cell className="text-muted">
                  <Tag tone="neutral">{label(CONSENT, p.consent_status)}</Tag>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </DataTable>
      )}
    </section>
  );
}
