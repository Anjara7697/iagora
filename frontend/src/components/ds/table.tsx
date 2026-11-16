"use client";

import { Pagination, ScrollShadow, Spinner, Table } from "@heroui/react";
import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { pageList } from "@/lib/pagination";
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
              <Table.Column key={c.id} id={c.id} isRowHeader={c.rowHeader ?? i === 0} className={cx("type-caption", c.className)}>
                {c.label}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body
            renderEmptyState={() =>
              isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 type-body text-muted" role="status">
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

/**
 * Sous 640 px, une liste de lignes à deux niveaux remplace le tableau (règle 4, UX-04) : nom et état sur la
 * première ligne, détails en dessous ; toute la ligne est un lien. Mêmes données que les colonnes du tableau.
 */
export function CompactList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-separator overflow-hidden rounded-lg bg-surface shadow-surface">
      {children}
    </ul>
  );
}

export function CompactRow({
  href,
  leading,
  title,
  aside,
  children,
}: {
  href: string;
  leading?: ReactNode;
  /** Nom de la ligne : c'est le lien, étendu à toute la ligne. */
  title: ReactNode;
  /** État à droite du nom (statut, consentement). */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    // Le lien porte le nom seul (WCAG 2.5.3) ; son pseudo-élément couvre la ligne, cliquable partout.
    <li className="relative flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-secondary has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus has-[a:focus-visible]:ring-inset">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <Link
            href={href}
            className="min-w-0 flex-1 type-body font-semibold break-words text-foreground outline-none after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </Link>
          <span className="flex shrink-0 flex-wrap justify-end gap-1.5">{aside}</span>
        </div>
        {children}
      </div>
    </li>
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
        {pageList(page, pages).map((p, i) =>
          p === null ? (
            <Pagination.Item key={`gap-${i}`}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ) : (
            <Pagination.Item key={p}>
              <Pagination.Link isActive={p === page} aria-label={`Page ${p}`} onPress={() => onChange(p)}>
                {p}
              </Pagination.Link>
            </Pagination.Item>
          ),
        )}
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
