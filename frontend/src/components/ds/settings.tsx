"use client";

import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { ErrorText, Notice } from "./controls";
import { Eyebrow, cx } from "./layout";

/**
 * Carte de réglages : sur-titre mono, titre, introduction, puis les lignes.
 * `region` nomme la carte pour les lecteurs d'écran ; `hidden` la garde dans la page
 * (une saisie en cours n'est pas perdue).
 */
export function SettingsCard({
  region,
  label,
  title,
  intro,
  aside,
  children,
  hidden,
  className,
}: {
  region: string;
  label?: string;
  title?: ReactNode;
  intro?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  hidden?: boolean;
  className?: string;
}) {
  return (
    <section
      data-ui="v2"
      aria-label={region}
      hidden={hidden}
      className={cx("card card--default gap-4 p-5", className)}
    >
      {(label || title || aside || intro) && (
        <div className="flex flex-col gap-1">
          {label && <Eyebrow>{label}</Eyebrow>}
          {(title || aside) && (
            <div className="flex flex-wrap items-center gap-3">
              {title && <h2 className="min-w-[200px] flex-1 text-base font-semibold text-foreground">{title}</h2>}
              {aside}
            </div>
          )}
          {intro && <p className="max-w-[76ch] text-[13px]/[20px] text-muted">{intro}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Ligne « libellé | champ + aide » : libellé à gauche sur bureau, au-dessus sur mobile. */
export function SettingRow({
  label,
  note,
  children,
}: {
  label: ReactNode;
  note?: ReactNode;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const auto = useId();
  const id = children.props.id ?? auto;
  const noteId = note ? `${id}-note` : undefined;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-separator pt-4">
      <label htmlFor={id} className="basis-full pt-2 text-[13px] font-medium text-foreground sm:basis-[220px] sm:shrink-0">
        {label}
      </label>
      <div className="flex min-w-[240px] max-w-[560px] flex-1 flex-col gap-1.5">
        {cloneElement(children, { id, "aria-describedby": noteId ?? children.props["aria-describedby"] })}
        {note && (
          <p id={noteId} className="text-xs/[18px] text-muted">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

/** Chiffres clés en mono (import, bilans). */
export function Stats({
  items,
  label,
}: {
  items: { value: ReactNode; caption: string }[];
  label?: string;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4" aria-label={label}>
      {items.map((i) => (
        <span key={i.caption} className="flex flex-col gap-1 rounded-xl bg-surface-secondary px-4 py-3">
          <span className="font-mono text-xl text-foreground tabular-nums">{i.value}</span>
          <span className="text-[13px]/[18px] text-muted">{i.caption}</span>
        </span>
      ))}
    </div>
  );
}

/** Résultat d'action sous une barre de boutons. */
export function Feedback({ notice, error }: { notice?: string | null; error?: string | null }) {
  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      {error && <ErrorText>{error}</ErrorText>}
    </>
  );
}

/** Rangée de boutons d'action en bas d'une carte. */
export function ActionsBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
