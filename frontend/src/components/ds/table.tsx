"use client";

import { Pagination, Spinner, Table } from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./layout";

export type DataColumn = {
  id: string;
  label: ReactNode;
  /** Colonne d'en-tête de ligne (la première, en général) : donne son nom à la ligne. */
  rowHeader?: boolean;
  className?: string;
};

/**
 * Tableau HeroUI : défilement horizontal sous `minWidth`, en-têtes de colonnes, lignes en enfants.
 * Les lignes sont des `Table.Row` (id unique, `href` pour une ligne qui ouvre une page) contenant des `Table.Cell`.
 * `isLoading` et `emptyState` alimentent le `renderEmptyState` du corps ; `footer` s'affiche dans `Table.Footer`.
 */
export function DataTable({
  label,
  columns,
  minWidth = 640,
  className,
  style,
  isLoading = false,
  loadingLabel = "Chargement…",
  emptyState,
  footer,
  children,
}: {
  label: string;
  columns: DataColumn[];
  minWidth?: number;
  className?: string;
  style?: CSSProperties;
  isLoading?: boolean;
  loadingLabel?: string;
  emptyState?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Table className={className} style={style}>
      <Table.ScrollContainer>
        <Table.Content aria-label={label} style={{ minWidth }}>
          <Table.Header>
            {columns.map((c, i) => (
              <Table.Column key={c.id} id={c.id} isRowHeader={c.rowHeader ?? i === 0} className={cx("text-xs", c.className)}>
                {c.label}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body
            renderEmptyState={() =>
              isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted" role="status">
                  <Spinner size="sm" />
                  {loadingLabel}
                </div>
              ) : (
                (emptyState ?? null)
              )
            }
          >
            {isLoading ? null : children}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
      {footer && <Table.Footer>{footer}</Table.Footer>}
    </Table>
  );
}

/** Pagination HeroUI pour `Table.Footer` : résumé « 1-10 sur 23 », précédent, pages, suivant. */
export function TablePagination({
  total,
  pageSize,
  page,
  onChange,
}: {
  total: number;
  pageSize: number;
  page: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <Pagination size="sm" className="w-full">
      <Pagination.Summary>
        {from}-{to} sur {total}
      </Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous isDisabled={page <= 1} onPress={() => onChange(page - 1)}>
            <Pagination.PreviousIcon />
            Précédent
          </Pagination.Previous>
        </Pagination.Item>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <Pagination.Item key={p}>
            <Pagination.Link isActive={p === page} aria-label={`Page ${p}`} onPress={() => onChange(p)}>
              {p}
            </Pagination.Link>
          </Pagination.Item>
        ))}
        <Pagination.Item>
          <Pagination.Next isDisabled={page >= pages} onPress={() => onChange(page + 1)}>
            Suivant
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}

export { Table };
