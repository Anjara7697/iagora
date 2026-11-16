"use client";

import { Chip } from "@heroui/react";
import { SlidersHorizontal, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Btn } from "./controls";
import { cx } from "./layout";

/** Filtre actif, affiché en puce retirable sous la barre. */
export type ActiveFilter = {
  /** Nom du filtre, lu dans « Retirer le filtre … ». */
  name: string;
  /** Texte de la puce (« Étape : Qualifié »). */
  text: ReactNode;
  clear: () => void;
};

/**
 * Barre au-dessus d'une liste (règle 5) : commandes à gauche (vue, recherche, périmètre, « Filtres · N »), compteur
 * à droite, puis les filtres actifs en puces retirables avec « Réinitialiser ». Même modèle pour toutes les listes.
 */
export function ListToolbar({
  label,
  count,
  filters = [],
  filtered = filters.length > 0,
  onReset,
  className,
  children,
  ...rest
}: Omit<ComponentProps<"section">, "children"> & {
  /** Nom de la zone (« Affichage et filtres des prospects »). */
  label: string;
  /** Compteur, annoncé quand il change (« 12 prospects sur 40 »). */
  count: ReactNode;
  filters?: ActiveFilter[];
  /** Un filtre est actif, dans la barre ou le panneau : « Réinitialiser » s'affiche. */
  filtered?: boolean;
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className={cx("flex flex-col gap-2", className)} {...rest}>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <span className="flex-1" />
        <span className="type-body-sm text-muted tabular-nums" role="status">
          {count}
        </span>
      </div>
      {(filters.length > 0 || (filtered && onReset)) && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtres actifs">
          {filters.map((f) => (
            <Btn key={f.name} size="sm" variant="tertiary" aria-label={`Retirer le filtre ${f.name}`} onClick={f.clear}>
              {f.text}
              <X className="size-3.5 text-muted" aria-hidden="true" />
            </Btn>
          ))}
          {onReset && (
            <Btn size="sm" variant="ghost" className="text-link" onClick={onReset}>
              Réinitialiser
            </Btn>
          )}
        </div>
      )}
    </section>
  );
}

/** Ouvre le panneau des filtres ; le nombre de filtres actifs s'affiche à côté (« Filtres · N »). */
export function FiltersButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Btn variant="secondary" aria-haspopup="dialog" onClick={onPress}>
      <SlidersHorizontal className="size-4" aria-hidden="true" />
      Filtres
      {count > 0 && (
        <Chip size="sm" color="accent" variant="primary" aria-label={`${count} actif${count > 1 ? "s" : ""}`}>
          <Chip.Label>{count}</Chip.Label>
        </Chip>
      )}
    </Btn>
  );
}

/** « 12 prospects », ou « 12 prospects sur 40 » quand un filtre est actif et que le total est connu. */
export function countLabel(total: number, noun: string, all?: number | null) {
  return `${total} ${noun}${total > 1 ? "s" : ""}${all != null ? ` sur ${all}` : ""}`;
}
