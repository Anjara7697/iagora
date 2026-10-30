"use client";

import { Button, Checkbox, Chip, Input, Label, ListBox, Select, TextArea, ToggleButton } from "@heroui/react";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { cloneElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cx } from "./layout";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger" | "danger-soft";

/**
 * Bouton HeroUI avec l'interface des écrans existants : `onClick` (appelé sans événement)
 * et `disabled`. Par défaut neutre (« tertiary ») ; « primary » pour l'action de l'écran.
 */
export function Btn({
  variant = "tertiary",
  size = "md",
  onClick,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
  children: ReactNode;
  isIconOnly?: boolean;
  fullWidth?: boolean;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-pressed"?: boolean;
  "aria-describedby"?: string;
  form?: string;
}) {
  return (
    <Button
      variant={variant}
      size={size}
      type={type}
      isDisabled={disabled}
      onPress={onClick ? () => onClick() : undefined}
      className={className}
      {...rest}
    >
      {children}
    </Button>
  );
}

const LINK_VARIANT: Record<"primary" | "tertiary" | "ghost" | "danger" | "outline", string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  tertiary: "bg-default text-foreground hover:bg-default-hover",
  outline: "border border-border bg-surface text-foreground hover:bg-surface-secondary",
  ghost: "text-foreground hover:bg-default",
  danger: "bg-danger text-danger-foreground hover:bg-danger-hover",
};

/** Lien qui a l'apparence d'un bouton (navigation, pas action). */
export function LinkButton({
  href,
  variant = "tertiary",
  size = "md",
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: keyof typeof LINK_VARIANT;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus",
        size === "sm" ? "h-8 px-3 text-sm" : "h-9 px-4 text-sm",
        LINK_VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}

/** Lien de texte (accent). */
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={cx(
        "rounded text-sm font-medium text-link underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus",
        className,
      )}
    />
  );
}

/**
 * Choix exclusif sur une ligne (onglets d'affichage) : boutons natifs `aria-pressed`,
 * présentés comme un contrôle segmenté HeroUI.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; text: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("inline-flex gap-0.5 rounded-lg bg-surface-tertiary p-[3px]", className)}
    >
      {options.map((o) => (
        <ToggleButton
          key={o.value}
          isSelected={o.value === value}
          onChange={() => onChange(o.value)}
          className={cx(
            "h-8 min-w-0 flex-1 rounded-md border-0 px-3 text-[13px] whitespace-nowrap",
            o.value === value
              ? "bg-segment text-foreground shadow-surface"
              : "bg-transparent text-muted shadow-none hover:text-foreground",
          )}
        >
          {o.text}
        </ToggleButton>
      ))}
    </div>
  );
}

/** Pastille de filtre basculante (`aria-pressed`). */
export function FilterChip({
  pressed,
  onClick,
  children,
  ...rest
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  "aria-expanded"?: boolean;
}) {
  return (
    <ToggleButton
      isSelected={pressed}
      onChange={() => onClick()}
      {...rest}
      className={cx(
        "h-8 gap-1.5 rounded-lg px-3 text-[13px] whitespace-nowrap",
        pressed
          ? "bg-accent-soft text-accent-soft-foreground"
          : "bg-surface text-foreground",
      )}
    >
      {children}
    </ToggleButton>
  );
}

/**
 * Libellé au-dessus d'un champ (relié par `htmlFor`, pour que le nom accessible soit
 * exactement le libellé), avec une aide facultative en dessous.
 */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  className?: string;
}) {
  const auto = useId();
  const id = children.props.id ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-foreground">
        {label}
      </label>
      {cloneElement(children, { id, "aria-describedby": hintId ?? children.props["aria-describedby"] })}
      {hint && (
        <span id={hintId} className="text-xs/[16px] font-normal text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Champ texte HeroUI (input natif). */
export function TextInput({ className, ...props }: Omit<ComponentProps<typeof Input>, "className"> & { className?: string }) {
  return <Input {...props} className={cx("w-full", className)} />;
}

/** Zone de texte HeroUI (textarea natif). */
export function TextBox({ className, ...props }: Omit<ComponentProps<typeof TextArea>, "className"> & { className?: string }) {
  return <TextArea {...props} className={cx("min-h-24 w-full", className)} />;
}

type SelectChoice = { value: string; label: string };
const EMPTY_SELECT_KEY = "__iagora_empty__";

/** Liste de choix HeroUI, avec libellé et popover accessibles. */
export function SelectInput({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
  id,
}: {
  label: string;
  value: string;
  options: SelectChoice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const items = options.map((option) => ({
    id: option.value || EMPTY_SELECT_KEY,
    ...option,
  }));
  const selectedKey = value || EMPTY_SELECT_KEY;
  return (
    <Select<(typeof items)[number]>
      aria-label={label}
      className={cx("flex min-w-0 flex-col gap-1.5", className)}
      fullWidth
      isDisabled={disabled}
      selectedKey={selectedKey}
      onSelectionChange={(key) =>
        onChange(String(key) === EMPTY_SELECT_KEY ? "" : String(key))
      }
    >
      <Label className="text-[13px] font-medium text-foreground">{label}</Label>
      <Select.Trigger id={id} className="rounded-lg" data-value={value}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox items={items}>
          {(item) => (
            <ListBox.Item id={item.id} textValue={item.label} data-value={item.value}>
              <Label>{item.label}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Liste de choix native, à l'apparence des champs HeroUI (clavier et mobile natifs). */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className={cx("relative inline-flex w-full", className)}>
      <select
        {...props}
        className="h-9 w-full min-w-0 cursor-pointer appearance-none rounded-[var(--field-radius)] border border-field-border bg-field-background py-0 pr-9 pl-3 text-sm text-field-foreground shadow-field outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
    </span>
  );
}

/** Case à cocher native, alignée sur son libellé. */
export function Check({
  checked,
  onChange,
  children,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Checkbox
      isSelected={checked}
      isDisabled={disabled}
      onChange={onChange}
      className={cx("rounded-lg", className)}
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <span className="flex flex-col gap-0.5 text-sm text-foreground">
          <span>{children}</span>
          {hint && <span className="text-xs text-muted">{hint}</span>}
        </span>
      </Checkbox.Content>
    </Checkbox>
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "agent" | "muted";

/** Puce d'état (tons : neutre, accent, succès, avertissement, danger, agent). */
export function Tag({
  tone = "neutral",
  children,
  icon,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const color = tone === "accent" || tone === "success" || tone === "warning" || tone === "danger" ? tone : "default";
  return (
    <Chip
      size="sm"
      variant="soft"
      color={color}
      className={cx("whitespace-nowrap", tone === "agent" && "chip--agent", tone === "muted" && "text-muted", className)}
    >
      {icon}
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  );
}

/** Message de réussite ou d'information sous une action. */
export function Notice({
  tone = "success",
  children,
  className,
}: {
  tone?: "success" | "info" | "warning";
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cx(
        "rounded-lg px-3 py-2 text-[13px]",
        tone === "success" && "bg-success-soft text-success-soft-foreground",
        tone === "info" && "bg-accent-soft text-accent-soft-foreground",
        tone === "warning" && "bg-warning-soft text-warning-soft-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Message d'erreur sous une action (le texte reste lisible, sans bouton). */
export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cx("rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-soft-foreground", className)}>
      {children}
    </p>
  );
}
