"use client";

import { Alert, Button, Card, Chip, Meter, ScrollShadow, Skeleton } from "@heroui/react";
import { RefreshCw, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { KpiBadge } from "@/lib/kpi";
import { Box } from "./card";
import { reveal } from "./motion";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Épaisseur du fondu des `ScrollShadow` (px) : une seule valeur pour la page et les tableaux (40 par défaut dans HeroUI). */
export const SCROLL_SHADOW_SIZE = 15;

/**
 * Racine d'un écran. Avec `scroll`, le contenu défile dans un `ScrollShadow` vertical (fondu en haut et en bas quand
 * il reste du contenu) dont la hauteur est bornée à celle de la fenêtre, sous l'en-tête de l'application.
 * `hideScrollBar` masque la barre de défilement.
 * Hauteurs (≥ 601 px) : en-tête 3.5rem + marge haute de `<main>` 1.75rem + 1rem laissé en bas = 6.25rem ; la marge basse
 * de `<main>` (4rem) est annulée par `-mb-12` pour que la fenêtre ne défile pas en plus du conteneur.
 * Sous 601 px : en-tête 3.5rem + marges de `<main>` (1.25rem en haut, 3rem en bas) = 8.25rem.
 */
export function Screen({
  children,
  className,
  wide,
  scroll = false,
  hideScrollBar = true,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
  scroll?: boolean;
  hideScrollBar?: boolean;
}) {
  const content = (
    <div className={cx("mx-auto flex w-full flex-col gap-6", wide ? "max-w-none" : "max-w-[1400px]", className)}>
      {children}
    </div>
  );
  if (!scroll) return content;
  return (
    <ScrollShadow
      orientation="vertical"
      size={SCROLL_SHADOW_SIZE}
      hideScrollBar={hideScrollBar}
      // -m-1 / p-1 : l'ombre des cartes et l'anneau de focus ne sont pas coupés par le conteneur.
      className="-m-1 max-h-[calc(100dvh-8.25rem)] p-1 min-[601px]:-mb-12 min-[601px]:max-h-[calc(100dvh-6.25rem)]"
    >
      {content}
    </ScrollShadow>
  );
}

/**
 * Liste qui défile seule dans une colonne de hauteur bornée (file d'« À traiter », liste des conversations, résultats
 * de recherche) : `ScrollShadow` HeroUI vertical, fondu en haut et en bas quand il reste du contenu. Le titre, les
 * filtres et la pagination restent hors du défilement. Sans hauteur bornée (mobile), elle prend sa hauteur naturelle.
 * Colonne collante (`lg:sticky lg:top-20`) : hauteur `calc(100dvh - 9rem)`, soit le haut collant (5rem) et la marge
 * basse de `<main>` (4rem) ; plus haute, elle remonterait sous la barre en bas de page.
 */
export function ListScroll({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ScrollShadow
      orientation="vertical"
      size={SCROLL_SHADOW_SIZE}
      // min-h-0 : se réduit dans une colonne flex bornée ; -m-1 / p-1 : ombre de carte et anneau de focus non coupés ;
      // overscroll-contain : arrivé au bout de la liste, la molette ne fait pas défiler la page derrière.
      className={cx("-m-1 min-h-0 overscroll-contain p-1", className)}
    >
      {children}
    </ScrollShadow>
  );
}

/** Ligne mono en capitales « Groupe · Page ». */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("type-caption tracking-[0.06em] text-muted uppercase", className)}>{children}</span>;
}

/**
 * En-tête d'écran (UX-10) : titre, puis une phrase facultative, actions à droite. Plus de sur-titre : il répétait le
 * groupe du menu. Les éléments d'un en-tête plus riche (fiche) passent par `subtitle`.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  style,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <header className={cx("flex flex-wrap items-center gap-x-4 gap-y-2", className)} style={style}>
      <div className="flex min-w-0 flex-1 basis-[280px] flex-col gap-0.5">
        <h1 className="type-title font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
        {subtitle && <div className="max-w-[72ch] type-body-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Carte titrée et nommée (région accessible) : `Card` HeroUI avec `Card.Header`, `Card.Title` (h2) et `Card.Content`. */
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
    <Box as="section" aria-label={label} className={className}>
      <Card.Header className="flex-row items-center gap-3">
        <Card.Title render={(props) => <h2 {...props} />} className="flex-1">
          {title}
        </Card.Title>
        {action}
      </Card.Header>
      <Card.Content className={bodyClassName}>{children}</Card.Content>
    </Box>
  );
}

/** Erreur de chargement lisible, avec nouvelle tentative. */
/** Erreur de chargement : `Alert` HeroUI danger (même apparence que `ErrorText`), avec « Réessayer » à droite. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert role="alert" status="danger" className="flex-wrap items-center">
      <Alert.Indicator />
      <Alert.Content className="min-w-[200px] flex-1">
        <Alert.Title>{message}</Alert.Title>
      </Alert.Content>
      {onRetry && (
        <Button size="sm" variant="tertiary" onPress={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Réessayer
        </Button>
      )}
    </Alert>
  );
}

/** Texte d'absence de contenu, sobre (pour une liste vide dans une carte). */
export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="py-2 type-body text-muted">{children}</p>;
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
      <span className="inline-flex size-12 items-center justify-center rounded-lg bg-surface-secondary text-muted" aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="type-title-sm font-semibold text-foreground">{title}</h2>
        {description && <span className="type-body text-muted">{description}</span>}
      </div>
      {action}
    </div>
  );
}

/** Chiffre clé : `Card` HeroUI (libellé en `Card.Description`), valeur en chiffres tabulaires, indication. Lien si `href`. */
export function KpiCard({
  label,
  value,
  hint,
  href,
  dot,
  pending,
  loading,
  badge,
  className,
  style,
}: {
  label: ReactNode;
  value?: ReactNode;
  hint?: ReactNode;
  href?: string;
  dot?: string;
  pending?: boolean;
  /** Chiffre en cours de chargement : `Skeleton` HeroUI à la place du chiffre et de la précision (taille conservée). */
  loading?: boolean;
  /** Lecture du chiffre (« Bon », « Faible »…) : pastille visible à côté du chiffre, qui reste de la couleur du texte. */
  badge?: KpiBadge;
  className?: string;
  style?: CSSProperties;
}) {
  const body = (
    <>
      <Card.Description className="flex items-center gap-2">
        {dot && <span className={cx("size-2 rounded-full", dot)} aria-hidden="true" />}
        {label}
      </Card.Description>
      {pending ? (
        <Card.Description>Pas encore mesuré</Card.Description>
      ) : loading ? (
        <>
          <Skeleton className="my-1 h-7 w-20 rounded-lg" />
          <Skeleton className="h-3 w-32 rounded-lg" />
          <span className="sr-only">Chargement</span>
        </>
      ) : (
        <>
          <span className="flex flex-wrap items-center gap-2">
            <Card.Title render={(props) => <span {...props} />} className="type-display tabular-nums">
              {value}
            </Card.Title>
            {badge && (
              <Chip size="sm" variant="soft" color={badge.tone}>
                <Chip.Label>{badge.label}</Chip.Label>
              </Chip>
            )}
          </span>
        </>
      )}
      {hint && !loading && <Card.Description>{hint}</Card.Description>}
    </>
  );
  if (href)
    return (
      <Box as={Link} href={href} className={className} style={style}>
        {body}
      </Box>
    );
  return (
    <Box variant={pending ? "transparent" : undefined} className={className} style={style}>
      {body}
    </Box>
  );
}

export type KpiItem = {
  key: string;
  label: ReactNode;
  value?: ReactNode;
  hint?: ReactNode;
  href?: string;
  dot?: string;
  pending?: boolean;
  loading?: boolean;
  badge?: KpiBadge;
};

/** Bandeau de chiffres clés : grille de `KpiCard` (rayon « lg »), apparition échelonnée à partir de `startIndex`. */
export function KpiStrip({
  label,
  items,
  startIndex = 0,
  cardClassName = "rounded-lg",
  className,
}: {
  label: string;
  items: KpiItem[];
  startIndex?: number;
  cardClassName?: string;
  className?: string;
}) {
  return (
    <section className={cx("grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4", className)} aria-label={label}>
      {items.map(({ key, ...item }, i) => {
        const motion = reveal(startIndex + i);
        return <KpiCard key={key} {...item} className={cx(cardClassName, motion.className)} style={motion.style} />;
      })}
    </section>
  );
}

/** Répartition en barres : libellé, barre, valeur en mono. La valeur porte l'information. */
export function BarList({
  rows,
  labelWidth = 112,
}: {
  rows: { key: string; label: ReactNode; value: number; color?: "default" | "accent" | "success" | "warning" | "danger"; fill?: string; title?: string }[];
  labelWidth?: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div
          key={r.key}
          className="grid items-center gap-3 type-body"
          style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr) 40px` }}
        >
          <span className="flex min-w-0 items-center gap-2 text-foreground">{r.label}</span>
          <Meter value={r.value} minValue={0} maxValue={max} aria-label={r.title ?? r.key} color={r.color} className="w-full">
            <Meter.Track>
              <Meter.Fill className={r.fill} />
            </Meter.Track>
          </Meter>
          <span className="text-right type-body-sm text-foreground tabular-nums">{r.value}</span>
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
