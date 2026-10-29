"use client";

import { Button } from "@heroui/react";
import { AlertTriangle, RefreshCw, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Racine d'un écran refait : soustrait le sous-arbre à l'ancienne feuille de style. */
export function Screen({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cx("mx-auto flex w-full flex-col gap-6", wide ? "max-w-none" : "max-w-[1400px]", className)}>
      {children}
    </div>
  );
}

/** Ligne mono en capitales « Groupe · Page ». */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-xs tracking-[0.06em] text-muted uppercase", className)}>{children}</span>;
}

/** En-tête d'écran : sur-titre, titre, sous-titre d'une phrase, actions à droite. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-end gap-4", className)}>
      <div className="flex min-w-0 flex-1 basis-[320px] flex-col gap-1">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="text-[28px]/[34px] font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
        {subtitle && <p className="max-w-[72ch] text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Carte titrée et nommée (région accessible) : titre, action à droite, contenu. */
export function Panel({
  title,
  label,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  label: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-label={label} className={cx("card card--default gap-0 p-0", className)}>
      <div className="flex min-h-14 items-center gap-3 border-b border-separator px-5 py-3">
        <h2 className="flex-1 text-base font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className={cx("flex flex-col", bodyClassName ?? "px-5 py-4")}>{children}</div>
    </section>
  );
}

/** Erreur de chargement lisible, avec nouvelle tentative. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-soft-foreground">
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" variant="tertiary" onPress={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Réessayer
        </Button>
      )}
    </div>
  );
}

/** Texte d'absence de contenu, sobre (pour une liste vide dans une carte). */
export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted">{children}</p>;
}

/** Écran ou liste vide : pictogramme, ce que c'est, pourquoi c'est vide, l'action suivante. */
export function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-surface-secondary text-muted" aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <span className="text-sm text-muted">{description}</span>}
      </div>
      {action}
    </div>
  );
}

/** Chiffre clé : libellé mono, valeur en chiffres tabulaires, indication. Lien si `href`. */
export function KpiCard({
  label,
  value,
  hint,
  href,
  dot,
  pending,
}: {
  label: ReactNode;
  value?: ReactNode;
  hint?: ReactNode;
  href?: string;
  dot?: string;
  pending?: boolean;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[13px] font-medium text-muted">
        {dot && <span className={cx("size-2 rounded-full", dot)} aria-hidden="true" />}
        {label}
      </span>
      {pending ? (
        <span className="text-sm text-muted">Pas encore mesuré</span>
      ) : (
        <span className="font-mono text-[28px]/8 tracking-[-0.02em] text-foreground tabular-nums">{value}</span>
      )}
      {hint && <span className="text-[13px]/[18px] text-muted">{hint}</span>}
    </>
  );
  const cls = "flex flex-col gap-2 rounded-xl bg-surface p-5 shadow-surface";
  if (pending) return <div className={cx(cls, "border border-dashed border-field-border/50 bg-transparent shadow-none")}>{body}</div>;
  if (href)
    return (
      <Link
        href={href}
        className={cx(cls, "outline-none transition-shadow duration-150 hover:shadow-overlay focus-visible:ring-2 focus-visible:ring-focus")}
      >
        {body}
      </Link>
    );
  return <div className={cls}>{body}</div>;
}

/** Répartition en barres : libellé, barre, valeur en mono. La valeur porte l'information. */
export function BarList({
  rows,
  labelWidth = 112,
}: {
  rows: { key: string; label: ReactNode; value: number; fill?: string; title?: string }[];
  labelWidth?: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div
          key={r.key}
          className="grid items-center gap-3 text-sm"
          style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr) 40px` }}
        >
          <span className="flex min-w-0 items-center gap-2 text-foreground">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-tertiary" aria-hidden="true">
            <span
              className={cx("block h-full rounded-full", r.fill ?? "bg-accent")}
              style={{ width: `${Math.round((r.value / max) * 100)}%` }}
            />
          </span>
          <span className="text-right font-mono text-[13px] text-foreground tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Avatar à initiales, couleur stable par nom. */
export function initialsOf(name: string) {
  const parts = name.split(/[\s.@_-]+/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(0, 2).map((p) => p[0]).join("") : name.slice(0, 2)).toUpperCase();
}
