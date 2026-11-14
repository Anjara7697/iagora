"use client";

import { Pagination, ScrollShadow, Spinner, Table } from "@heroui/react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { SCROLL_SHADOW_SIZE, cx } from "./layout";

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
 * Le défilement horizontal passe par `ScrollShadow` ; le tableau est en `rounded-lg`.
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
  hideScrollBar = true,
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
  /** Masque la barre de défilement horizontal (l'ombre sur les bords indique qu'il reste du contenu). */
  hideScrollBar?: boolean;
  children?: ReactNode;
}) {
  return (
    <Table className={cx("rounded-lg", className)} style={style}>
      <ScrollShadow orientation="horizontal" size={SCROLL_SHADOW_SIZE} hideScrollBar={hideScrollBar}>
        <Table.Content aria-label={label} style={{ minWidth }}>
          <Table.Header>
            {columns.map((c, i) => (
              <Table.Column key={c.id} id={c.id} isRowHeader={c.rowHeader ?? i === 0} className={cx("text-caption", c.className)}>
                {c.label}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body
            renderEmptyState={() =>
              isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-body text-muted" role="status">
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
      </ScrollShadow>
      {footer && <Table.Footer>{footer}</Table.Footer>}
    </Table>
  );
}

/** Pagination côté client d'une liste déjà chargée : page courante (bornée), éléments de la page, retour à la page 1. */
export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  return {
    page: current,
    setPage,
    reset: () => setPage(1),
    pageItems: items.slice((current - 1) * pageSize, current * pageSize),
    total: items.length,
    pageSize,
    /** Pagination à afficher dans `Table.Footer` : seulement si la liste dépasse une page. */
    footer:
      items.length > pageSize ? (
        <TablePagination total={items.length} pageSize={pageSize} page={current} onChange={setPage} />
      ) : undefined,
  };
}

/**
 * Pagination HeroUI pour `Table.Footer` : résumé « 1-10 sur 23 », précédent, pages, suivant. `className` règle
 * la mise en page (ex. `flex-wrap` dans une colonne étroite).
 */
export function TablePagination({
  total,
  pageSize,
  page,
  onChange,
  className = "",
}: {
  total: number;
  pageSize: number;
  page: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <Pagination size="sm" className={`w-full ${className}`.trim()}>
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
