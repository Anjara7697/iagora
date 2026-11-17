"use client";

import { Gauge, History } from "lucide-react";
import type { ReactNode } from "react";
import { reveal } from "@/components/ds/motion";
import { Btn, FilterChipGroup, Tag } from "@/components/ds/controls";
import { EmptyPanel } from "@/components/ds/layout";
import { CompactList, CompactRow, DataTable, Table } from "@/components/ds/table";
import { ListToolbar, countLabel } from "@/components/ds/toolbar";
import { NARROW, useMediaQuery } from "@/lib/useMediaQuery";
import { STATUS, SUITES, formatRunDate, headline, runHref, type EvalRun, type Suite } from "@/lib/evaluation";

export function RunStatus({ run }: { run: EvalRun }) {
  const s = STATUS[run.status] ?? STATUS.done;
  const progress = run.status === "running" && run.progress ? ` · ${run.progress.done}/${run.progress.total}` : "";
  return (
    <Tag tone={s.tone}>
      {s.label}
      {progress}
    </Tag>
  );
}

/** Historique des passages (règles 4 et 5) : toute la ligne ouvre le passage ; filtre par suite, compteur à droite. */
export default function RunsTable({
  runs,
  isLoading,
  suite,
  onSuite,
  emptyAction,
}: {
  runs: EvalRun[];
  isLoading: boolean;
  suite: Suite | "";
  onSuite: (suite: Suite | "") => void;
  emptyAction?: ReactNode;
}) {
  const narrow = useMediaQuery(NARROW);
  const shown = suite ? runs.filter((r) => r.suite === suite) : runs;
  const suites = (Object.keys(SUITES) as Suite[]).filter((s) => runs.some((r) => r.suite === s));

  return (
    <section aria-label="Historique des passages" className="flex flex-col gap-3">
      {runs.length > 0 && (
        <ListToolbar
          label="Filtre des passages"
          count={isLoading ? "" : countLabel(shown.length, "passage", suite ? runs.length : null)}
        >
          <FilterChipGroup
            label="Suite"
            options={[{ value: "", text: "Toutes" }, ...suites.map((s) => ({ value: s, text: SUITES[s] }))]}
            value={suite}
            onChange={(value) => onSuite(value as Suite | "")}
          />
        </ListToolbar>
      )}

      {narrow && shown.length > 0 ? (
        <CompactList label="Passages d’évaluation">
          {shown.map((r) => (
            <CompactRow key={r.id} href={runHref(r.id)} title={r.label} aside={<RunStatus run={r} />}>
              <span className="type-caption text-muted">
                {r.suite_label} · {headline(r)} conformes
              </span>
              <span className="type-caption text-muted">
                {formatRunDate(r.ran_at)} · {r.model ?? "modèle inconnu"}
              </span>
            </CompactRow>
          ))}
        </CompactList>
      ) : (
        <DataTable
          label="Passages d’évaluation"
          minWidth={760}
          isLoading={isLoading}
          loadingLabel="Chargement des passages…"
          columns={[
            { id: "label", label: "Passage", className: "min-w-[220px]" },
            { id: "suite", label: "Suite" },
            { id: "conform", label: "Conformes" },
            { id: "model", label: "Modèle" },
            { id: "date", label: "Date" },
            { id: "status", label: "État" },
          ]}
          emptyState={
            suite ? (
              <EmptyPanel
                icon={History}
                title="Aucun passage pour cette suite"
                description={SUITES[suite]}
                action={
                  <Btn variant="secondary" onClick={() => onSuite("")}>
                    Afficher tous les passages
                  </Btn>
                }
              />
            ) : (
              <EmptyPanel
                icon={Gauge}
                title="Aucun passage pour l’instant"
                description="Lancez une évaluation, ou importez les rapports JSON déjà produits en ligne de commande pour que l’historique parte de la première mesure."
                action={emptyAction}
              />
            )
          }
        >
          {shown.map((r, i) => (
            <Table.Row
              key={r.id}
              id={r.id}
              href={runHref(r.id)}
              className={`cursor-pointer ${reveal(4 + i, 40).className}`}
              style={reveal(4 + i, 40).style}
            >
              <Table.Cell>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <strong className="type-body font-medium text-foreground">{r.label}</strong>
                  {r.notes && <span className="line-clamp-1 type-caption text-muted">{r.notes}</span>}
                </span>
              </Table.Cell>
              <Table.Cell className="whitespace-nowrap text-muted">{r.suite_label}</Table.Cell>
              <Table.Cell className="whitespace-nowrap tabular-nums">{headline(r)}</Table.Cell>
              <Table.Cell className="type-caption break-all text-muted">{r.model ?? "-"}</Table.Cell>
              <Table.Cell className="type-caption whitespace-nowrap text-muted tabular-nums">{formatRunDate(r.ran_at)}</Table.Cell>
              <Table.Cell>
                <RunStatus run={r} />
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      )}
    </section>
  );
}
