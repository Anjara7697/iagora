"use client";

import { FileSearch, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { DemoChip } from "@/components/ds/badges";
import { reveal } from "@/components/ds/motion";
import { Btn, Field, FilterChipGroup, Tag, TextInput } from "@/components/ds/controls";
import { EmptyPanel } from "@/components/ds/layout";
import { DataTable, Table } from "@/components/ds/table";
import { COMMON, type KnowledgeView } from "@/lib/knowledgeNav";
import { TARGETS, formatDate, label } from "@/lib/labels";
import type { KnowledgeDocument } from "@/lib/types";

const programmeOf = (d: KnowledgeDocument) => d.target_code ?? COMMON;
const programmeLabel = (code: string) => (code === COMMON ? "Documents communs" : label(TARGETS, code));

/**
 * Documents de la base : recherche par titre ou identifiant, filtre par programme (dans l'adresse), tableau complet.
 * Toute la ligne ouvre le document (clic ou Entrée).
 */
export default function DocumentList({
  documents,
  isLoading,
  view,
  selected,
  emptyAction,
  onChange,
  onOpen,
}: {
  documents: KnowledgeDocument[];
  isLoading: boolean;
  view: KnowledgeView;
  selected: string | null;
  /** Action de l'état vide (première utilisation), ex. « Ajouter un document » pour l'administrateur. */
  emptyAction?: ReactNode;
  onChange: (patch: Partial<KnowledgeView>) => void;
  onOpen: (slug: string) => void;
}) {
  const programmes = Array.from(new Set(documents.map(programmeOf)));
  const needle = view.q.trim().toLocaleLowerCase("fr");
  const shown = documents.filter(
    (d) =>
      (!view.programme || programmeOf(d) === view.programme) &&
      (!view.status || d.needs_reindex) &&
      `${d.title} ${d.slug}`.toLocaleLowerCase("fr").includes(needle),
  );
  const filtered = !!view.q || !!view.programme || !!view.status;
  const toReindex = documents.filter((d) => d.needs_reindex).length;

  return (
    // Règle des parcours : le tableau HeroUI est posé sur la page (pas de carte autour), filtres au-dessus.
    <section className="flex flex-col gap-4" aria-label="Documents disponibles">
      {(documents.length > 0 || filtered) && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Rechercher un document" className="w-full sm:w-72">
            <TextInput
              type="search"
              value={view.q}
              onChange={(e) => onChange({ q: e.target.value })}
              placeholder="Titre ou identifiant…"
            />
          </Field>
          {programmes.length > 1 && (
            <FilterChipGroup
              label="Programme"
              options={[{ value: "", text: "Tous" }, ...programmes.map((code) => ({ value: code, text: programmeLabel(code) }))]}
              value={view.programme}
              onChange={(value) => onChange({ programme: value })}
            />
          )}
          {(toReindex > 0 || view.status) && (
            <FilterChipGroup
              label="Statut"
              options={[{ value: "reindex", text: `À recalculer (${toReindex})` }]}
              value={view.status}
              onChange={() => onChange({ status: view.status ? "" : "reindex" })}
            />
          )}
          <span className="ml-auto text-[13px] text-muted tabular-nums" role="status">
            {isLoading ? "" : `${shown.length} document${shown.length > 1 ? "s" : ""}${filtered ? ` sur ${documents.length}` : ""}`}
          </span>
        </div>
      )}

      <DataTable
        label="Liste des documents"
        minWidth={720}
        isLoading={isLoading}
        loadingLabel="Chargement des documents…"
        columns={[
          { id: "doc", label: "Document", className: "min-w-[260px]" },
          { id: "program", label: "Programme" },
          { id: "chunks", label: "Extraits", className: "text-right" },
          { id: "updated", label: "Mis à jour" },
          { id: "status", label: "Statut" },
        ]}
        emptyState={
          filtered ? (
            <EmptyPanel
              icon={FileSearch}
              title="Aucun document ne correspond"
              description={[view.q && `Recherche « ${view.q.trim()} »`, view.programme && programmeLabel(view.programme), view.status && "À recalculer"]
                .filter(Boolean)
                .join(" · ")}
              action={
                <Btn variant="secondary" onClick={() => onChange({ q: "", programme: "", status: "" })}>
                  Afficher tous les documents
                </Btn>
              }
            />
          ) : (
            <EmptyPanel
              icon={FileText}
              title="Aucun document pour l’instant"
              description="Les documents de référence (programmes, conditions, financement) permettent à l’agent de répondre sans inventer."
              action={emptyAction}
            />
          )
        }
      >
        {shown.map((d, i) => (
          <Table.Row
            key={d.slug}
            id={d.slug}
            onAction={() => onOpen(d.slug)}
            className={`cursor-pointer ${d.slug === selected ? "bg-accent-soft/50" : ""} ${reveal(6 + i, 40).className}`}
            style={reveal(6 + i, 40).style}
          >
            <Table.Cell>
              <span className="flex items-start gap-2.5">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <strong className="text-sm font-medium text-foreground">{d.title}</strong>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {d.slug}
                    {d.is_demo && <DemoChip />}
                  </span>
                </span>
              </span>
            </Table.Cell>
            <Table.Cell className="whitespace-nowrap text-muted">{d.target_code ? label(TARGETS, d.target_code) : "Tous"}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{d.chunks}</Table.Cell>
            <Table.Cell className="text-xs whitespace-nowrap text-muted tabular-nums">{formatDate(d.updated_at)}</Table.Cell>
            <Table.Cell>
              <Tag tone={d.needs_reindex ? "warning" : "success"}>{d.needs_reindex ? "À recalculer" : "À jour"}</Tag>
            </Table.Cell>
          </Table.Row>
        ))}
      </DataTable>

      {documents.some((d) => d.is_demo) && (
        <p className="text-xs/[18px] text-muted">
          Les documents « Fictif » sont des données de démonstration : ils ne sont jamais utilisés en production.
        </p>
      )}
    </section>
  );
}

