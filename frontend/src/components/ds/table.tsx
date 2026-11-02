"use client";

import { Table } from "@heroui/react";
import type { ReactNode } from "react";
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
 * Les lignes sont des `Table.Row` (id unique) contenant des `Table.Cell`.
 */
export function DataTable({
  label,
  columns,
  minWidth = 640,
  className,
  children,
}: {
  label: string;
  columns: DataColumn[];
  minWidth?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Table className={className}>
      <Table.ScrollContainer>
        <Table.Content aria-label={label} style={{ minWidth }}>
          <Table.Header>
            {columns.map((c, i) => (
              <Table.Column key={c.id} id={c.id} isRowHeader={c.rowHeader ?? i === 0} className={cx("text-xs", c.className)}>
                {c.label}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>{children}</Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

export { Table };
