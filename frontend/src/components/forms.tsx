"use client";

import { Switch } from "@heroui/react";
import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

/** Carte de réglages (maquette) : libellé de section en capitales mono, titre, intro. */
export function Section({
  label,
  title,
  intro,
  aside,
  children,
  region,
  hidden,
}: {
  label?: string;
  title?: string;
  intro?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  region: string;
  /** Masquée mais conservée dans la page : une saisie en cours n'est pas perdue. */
  hidden?: boolean;
}) {
  return (
    <section className="section-card" aria-label={region} hidden={hidden}>
      {label && <span className="section-label">{label}</span>}
      {(title || aside) && (
        <div className="section-head">
          {title && <h2>{title}</h2>}
          {aside}
        </div>
      )}
      {intro && <p className="section-intro">{intro}</p>}
      {children}
    </section>
  );
}

/** Ligne « libellé | champ + note » ; le libellé est relié au champ (accessibilité). */
export function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: ReactNode;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-describedby": note ? noteId : undefined,
      })
    : children;
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-control">
        {control}
        {note && (
          <p className="field-note" id={noteId}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
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
    <div className="toggle-row">
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
    <div className="secret-once" role="status" aria-label={label}>
      <span className="section-intro">{intro}</span>
      <div className="row">
        <code>{secret}</code>
        <button
          onClick={() =>
            navigator.clipboard
              ?.writeText(secret)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      {children}
      <span className="field-note">
        Il ne sera plus affiché : conservez-le maintenant.
      </span>
      <div className="row">
        <button onClick={onDone}>{doneLabel}</button>
      </div>
    </div>
  );
}

/** Chiffres clés en police mono (import, bilans). */
export function Stats({
  items,
  label,
}: {
  items: { value: ReactNode; caption: string }[];
  label?: string;
}) {
  return (
    <div className="stat-grid" aria-label={label}>
      {items.map((i) => (
        <span key={i.caption} className="stat-item">
          <span className="stat-number">{i.value}</span>
          <span className="stat-caption">{i.caption}</span>
        </span>
      ))}
    </div>
  );
}

/** Résultat d'action sous une barre de boutons. */
export function Feedback({
  notice,
  error,
}: {
  notice?: string | null;
  error?: string | null;
}) {
  return (
    <>
      {notice && (
        <p role="status" className="status-text status-ok">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export const initials = (name: string) => {
  const parts = name.split(/[.\s_@-]+/).filter(Boolean);
  return (
    parts.length > 1
      ? parts
          .slice(0, 2)
          .map((p) => p[0])
          .join("")
      : name.slice(0, 2)
  ).toUpperCase();
};
