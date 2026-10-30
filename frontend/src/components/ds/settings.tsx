"use client";

import { Switch } from "@heroui/react";
import { Check, Copy } from "lucide-react";
import { cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { formatDate } from "@/lib/labels";
import type { Tone as StateTone } from "@/lib/types";
import { Btn, ErrorText, Notice, Tag, type Tone } from "./controls";
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
          <span className="text-xl text-foreground tabular-nums">{i.value}</span>
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

/** Ligne d'information sans champ (« libellé | valeur + aide »), alignée sur `SettingRow`. */
export function InfoRow({ label, note, children }: { label: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-separator pt-4">
      <span className="basis-full text-[13px] font-medium text-foreground sm:basis-[220px] sm:shrink-0">{label}</span>
      <div className="flex min-w-[240px] max-w-[560px] flex-1 flex-col gap-1.5 text-sm text-foreground">
        {children}
        {note && <p className="text-xs/[18px] text-muted">{note}</p>}
      </div>
    </div>
  );
}

/** Valeur technique à recopier telle quelle (URI de redirection, hôte…). */
export function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <code className="block rounded-xl border border-separator bg-surface-secondary px-3 py-2 font-mono text-[12.5px]/[18px] break-all text-foreground">
      {children}
    </code>
  );
}

const STATE_TONE: Record<StateTone, Tone> = { ok: "success", warn: "warning", err: "danger", off: "neutral" };

/** État d'un connecteur (configuré, à configurer, erreur, bientôt). */
export function StatePill({ tone, children }: { tone: StateTone; children: ReactNode }) {
  return <Tag tone={STATE_TONE[tone] ?? "neutral"}>{children}</Tag>;
}

/** Réglage activé ou non : titre et conséquence à gauche, interrupteur HeroUI à droite. */
export function Toggle({
  checked,
  onChange,
  title,
  note,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  note?: ReactNode;
}) {
  return (
    <div className="border-t border-separator pt-4">
      <Switch isSelected={checked} onChange={onChange} className="w-full">
        <Switch.Content className="flex w-full items-start justify-between gap-6">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium text-foreground">{title}</span>
            {note && <span className="text-[12.5px]/[18px] font-normal text-muted">{note}</span>}
          </span>
          <Switch.Control className="mt-0.5 shrink-0">
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  );
}

/** Secret affiché une seule fois (mot de passe temporaire, jeton) avec bouton Copier. */
export function SecretOnce({
  label,
  intro,
  secret,
  doneLabel,
  onDone,
  children,
}: {
  label: string;
  intro: ReactNode;
  secret: string;
  doneLabel: string;
  onDone: () => void;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
     
      role="status"
      aria-label={label}
      className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning-soft/50 px-4 py-4"
    >
      <span className="text-[13px]/[20px] text-foreground">{intro}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-xl border border-separator bg-surface px-3 py-2 font-mono text-[13px] break-all text-foreground">
          {secret}
        </code>
        <Btn
          size="sm"
          variant="outline"
          onClick={() =>
            navigator.clipboard
              ?.writeText(secret)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copié" : "Copier"}
        </Btn>
      </div>
      {children}
      <span className="text-xs text-warning-soft-foreground">Il ne sera plus affiché : conservez-le maintenant.</span>
      <ActionsBar>
        <Btn size="sm" variant="primary" onClick={onDone}>
          {doneLabel}
        </Btn>
      </ActionsBar>
    </div>
  );
}

/** Comptes connectés par les conseillers (agenda, visio). */
export function ConnectedAccounts({
  label,
  items,
  fallback,
}: {
  label: string;
  items: { user_id: number; username?: string | null; account_email?: string | null; connected_at?: string | null; last_error?: string | null }[];
  fallback: string;
}) {
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {items.map((c) => {
        const name = c.username ?? `#${c.user_id}`;
        return (
          <li key={c.user_id} className="flex items-center gap-3 rounded-xl bg-surface-secondary px-3 py-2.5">
            <span
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-foreground"
              aria-hidden="true"
            >
              {name.replace("#", "").slice(0, 2).toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-1 flex-col text-[13px]">
              <strong className="font-semibold text-foreground">{name}</strong>
              <span className="truncate text-muted">
                {c.account_email ?? fallback} · connecté le {formatDate(c.connected_at ?? null)}
              </span>
            </span>
            {c.last_error ? <Tag tone="danger">À reconnecter</Tag> : <Tag tone="success">Connecté</Tag>}
          </li>
        );
      })}
    </ul>
  );
}
