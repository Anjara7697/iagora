"use client";

/** Vue « Pipeline » de la liste des prospects : une colonne par étape, défilement horizontal. */

import { ScrollShadow } from "@heroui/react";
import Link from "next/link";
import { SCROLL_SHADOW_SIZE } from "@/components/ds/layout";
import { DemoBadge, ScoreBadge, StageBadge } from "@/components/ui";
import { formatDate, fullName } from "@/lib/labels";
import type { Membership, Page, Prospect } from "@/lib/types";
import { ConsentTag, PIPELINE_COLUMNS, ProspectAvatar, level, type PipelineColumn } from "@/components/prospects/shared";

/**
 * Pipeline : colonnes par étape dans un `ScrollShadow` horizontal (règle 9), fondu sur le bord tant qu'il reste des
 * colonnes. La zone se fait défiler à la souris, au doigt ou au clavier (flèches une fois focalisée).
 */
function PipelineScroller({ children }: { children: React.ReactNode }) {
  return (
    <ScrollShadow
      orientation="horizontal"
      size={SCROLL_SHADOW_SIZE}
      className="flex snap-x gap-4 overflow-x-auto pb-3 outline-none focus-visible:ring-2 focus-visible:ring-focus"
      tabIndex={0}
      role="region"
      aria-label="Pipeline des prospects, défilement horizontal"
    >
      {children}
    </ScrollShadow>
  );
}

export function ProspectPipeline({
  data,
  stage,
  memberships,
  profileHref,
}: {
  data: Page<Prospect>;
  /** Filtre d'étape : seules sa colonne et « Sorties » restent affichées. */
  stage: string;
  memberships: (p: Prospect) => Membership[];
  profileHref: (id: number) => string;
}) {
  const columns = PIPELINE_COLUMNS.filter(
    (column) =>
      (!stage || column.stages.includes(stage) || column.key === "exit") &&
      (column.key !== "unassigned" || data.items.some((p) => p.campaigns.length === 0)),
  );
  function inColumn(p: Prospect, column: PipelineColumn) {
    if (column.key === "exit")
      return p.consent_status === "opted_out" || memberships(p).some((m) => m.conversion_stage === "lost");
    if (p.consent_status === "opted_out") return false;
    if (column.key === "unassigned") return p.campaigns.length === 0;
    return memberships(p).some((m) => column.stages.includes(m.conversion_stage));
  }
  return (
    <>
      <p className="text-[13px] text-muted">
        {data.total > data.items.length
          ? `${data.items.length} prospect${data.items.length > 1 ? "s" : ""} affiché${data.items.length > 1 ? "s" : ""} sur ${data.total}. Affinez les filtres ou utilisez la vue Table pour parcourir l’ensemble.`
          : `${data.total} prospect${data.total > 1 ? "s" : ""}.`}{" "}
        Faites défiler horizontalement pour parcourir les étapes.
      </p>
      <PipelineScroller>
        {columns.map((column) => {
          const { key, title } = column;
          const items = data.items.filter((p) =>
            inColumn(p, column),
          );
          return (
            <section
              className={`flex w-[272px] shrink-0 snap-start flex-col gap-2 rounded-lg p-2 ${key === "exit" ? "bg-surface-tertiary/60" : "bg-surface-secondary"}`}
              key={key}
              aria-label={title}
            >
              <header className="flex items-center gap-2 px-2 py-1.5">
                <h2 className="flex-1 text-sm font-semibold text-foreground">{title}</h2>
                <span className="rounded-md bg-surface px-1.5 text-xs text-muted tabular-nums">{items.length}</span>
              </header>
              {items.map((p) => (
                <Link
                  className="pipeline-card flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-surface outline-none transition-shadow duration-150 hover:shadow-overlay focus-visible:ring-2 focus-visible:ring-focus"
                  key={p.id}
                  href={profileHref(p.id)}
                >
                  <div className="flex items-center gap-2">
                    <ProspectAvatar prospect={p} />
                    <strong className="min-w-0 flex-1 text-[13px] font-semibold break-words text-foreground">{fullName(p)}</strong>
                    <DemoBadge email={p.email} />
                  </div>
                  <span className="text-xs break-all text-muted">
                    {p.email ||
                      p.phone ||
                      "Coordonnées non renseignées"}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {memberships(p)
                      .filter((m) =>
                        column.stages.includes(m.conversion_stage),
                      )
                      .map((m) => (
                        <span key={m.id} className="flex min-w-0 flex-col gap-1">
                          <span className="truncate text-xs font-medium text-foreground">
                            {m.campaign_name ?? "Campagne"}
                          </span>
                          <span className="flex flex-wrap gap-1.5">
                            <StageBadge stage={m.conversion_stage} />
                            <ScoreBadge
                              total={m.total_score}
                              level={level(m.total_score)}
                            />
                          </span>
                        </span>
                      ))}
                    <ConsentTag status={p.consent_status} />
                  </div>
                  <span className="text-xs text-muted">
                    Créé le {formatDate(p.created_at)}
                  </span>
                </Link>
              ))}
              {!items.length && (
                <p
                  className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted"
                  title={
                    data.total > data.items.length
                      ? "Aucun parmi les prospects affichés sur cette page"
                      : "Aucun prospect à cette étape"
                  }
                >
                  Aucun
                </p>
              )}
            </section>
          );
        })}
      </PipelineScroller>
    </>
  );
}
