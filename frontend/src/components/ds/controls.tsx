"use client";

import { Alert, Button, buttonVariants, Checkbox, Chip, Input, Label, ListBox, Select, TextArea, ToggleButton } from "@heroui/react";
import Link from "next/link";
import { Children, cloneElement, isValidElement, useId, useRef, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cx } from "./layout";

type ButtonProps = ComponentProps<typeof Button>;

/**
 * Bouton HeroUI : toutes les propriétés du `Button` (variant, size, color, isIconOnly, onPress, ref…)
 * sont acceptées. Raccourcis : `onClick` (appelé sans événement) et `disabled`.
 * Par défaut neutre (« tertiary ») et `type="button"` ; « primary » pour l'action de l'écran.
 */
export function Btn({
  variant = "tertiary",
  type = "button",
  onClick,
  onPress,
  disabled,
  isDisabled,
  ...rest
}: Omit<ButtonProps, "onClick"> & { onClick?: () => void; disabled?: boolean }) {
  return (
    <Button
      variant={variant}
      type={type}
      isDisabled={isDisabled ?? disabled}
      onPress={onClick || onPress ? (e) => { onPress?.(e); onClick?.(); } : undefined}
      {...rest}
    />
  );
}

/** Ligne cliquable d'une liste (file, conversations) : bouton HeroUI sur toute la largeur, `aria-current` si sélectionnée. */
export function RowButton({
  selected,
  onClick,
  onPress,
  className,
  ...rest
}: Omit<ButtonProps, "onClick" | "variant"> & { selected: boolean; onClick?: () => void }) {
  return (
    <Button
      variant="ghost"
      aria-current={selected ? "true" : undefined}
      onPress={onClick || onPress ? (e) => { onPress?.(e); onClick?.(); } : undefined}
      className={cx(
        "h-auto w-full items-start justify-start gap-3 rounded-xl px-3 py-3 text-left font-normal whitespace-normal",
        selected ? "bg-accent-soft" : "hover:bg-surface-secondary",
        typeof className === "string" ? className : undefined,
      )}
      {...rest}
    />
  );
}

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
  variant?: "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger" | "danger-soft";
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link href={href} className={buttonVariants({ variant, size, className })} {...rest}>
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
  className,
  ...rest
}: Omit<ComponentProps<typeof ToggleButton>, "isSelected" | "onChange" | "className"> & {
  pressed: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <ToggleButton
      isSelected={pressed}
      onChange={() => onClick?.()}
      className={cx(
        "h-8 gap-1.5 rounded-lg px-3 text-[13px] whitespace-nowrap",
        pressed
          ? "bg-accent-soft text-accent-soft-foreground"
          : "border border-border bg-surface text-foreground",
        className,
      )}
      {...rest}
    />
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
  const labelId = `${id}-label`;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <label id={labelId} htmlFor={id} className="text-[13px] font-medium text-foreground">
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": hintId ?? children.props["aria-describedby"],
        ...(children.type === SelectBox ? { "aria-labelledby": labelId } : {}),
      } as Record<string, string | undefined>)}
      {hint && (
        <span id={hintId} className="text-xs/[16px] font-normal text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Champ texte HeroUI : toutes les propriétés de `Input` (variant, fullWidth…), pleine largeur par défaut. */
export function TextInput({ fullWidth = true, ...props }: ComponentProps<typeof Input>) {
  return <Input fullWidth={fullWidth} {...props} />;
}

/** Zone de texte HeroUI : toutes les propriétés de `TextArea`, pleine largeur par défaut. */
export function TextBox({ fullWidth = true, className, ...props }: ComponentProps<typeof TextArea>) {
  return <TextArea fullWidth={fullWidth} className={cx("min-h-24", typeof className === "string" ? className : undefined)} {...props} />;
}

type SelectChoice = { value: string; label: string };
type SelectItem = { id: string; value: string; text: string };
const EMPTY_SELECT_KEY = "__iagora_empty__";

type SelectRootProps = ComponentProps<typeof Select<SelectItem>>;
/** Propriétés du `Select` HeroUI (variant, fullWidth, placeholder, isInvalid, name…) acceptées telles quelles. */
type SelectPassThrough = Omit<
  SelectRootProps,
  "children" | "items" | "selectedKey" | "defaultSelectedKey" | "onSelectionChange" | "value" | "onChange"
> & { isDisabled?: boolean; isRequired?: boolean };

/** Rendu commun : `Select` HeroUI, déclencheur, popover et options. Libellé visible ou masqué. */
function SelectView({
  items,
  value,
  onValueChange,
  label,
  labelHidden,
  triggerId,
  fullWidth = true,
  ...rest
}: SelectPassThrough & {
  items: SelectItem[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  labelHidden?: boolean;
  triggerId?: string;
  isDisabled?: boolean;
  isRequired?: boolean;
}) {
  return (
    <Select<SelectItem>
      fullWidth={fullWidth}
      {...rest}
      aria-label={rest["aria-label"] ?? label}
      selectedKey={value || EMPTY_SELECT_KEY}
      onSelectionChange={(key) => onValueChange(String(key) === EMPTY_SELECT_KEY ? "" : String(key))}
    >
      {label && <Label className={labelHidden ? "sr-only" : undefined}>{label}</Label>}
      <Select.Trigger id={triggerId} data-value={value}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox items={items}>
          {(item) => (
            <ListBox.Item id={item.id} textValue={item.text} data-value={item.value}>
              <Label>{item.text}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Liste de choix HeroUI avec libellé visible et options en tableau. Accepte les propriétés du `Select`. */
export function SelectInput({
  label,
  value,
  options,
  onChange,
  disabled,
  id,
  ...rest
}: SelectPassThrough & {
  label: string;
  value: string;
  options: SelectChoice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const items = options.map((o) => ({ id: o.value || EMPTY_SELECT_KEY, value: o.value, text: o.label }));
  return (
    <SelectView
      {...rest}
      items={items}
      value={value}
      onValueChange={onChange}
      label={label}
      triggerId={id}
      isDisabled={rest.isDisabled ?? disabled}
    />
  );
}

/**
 * Liste de choix HeroUI à interface de `<select>` : `<option>` en enfants et `onChange` avec `e.target.value`.
 * Libellé externe (`id` + `aria-labelledby`) ou masqué (`aria-label`). Accepte les propriétés du `Select`
 * (variant, fullWidth, placeholder, isInvalid…).
 */
export function SelectBox({
  value,
  onChange,
  disabled,
  required,
  id,
  children,
  ...rest
}: SelectPassThrough & {
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children)
    .filter((c): c is ReactElement<{ value?: string; children?: ReactNode }> => isValidElement(c))
    .map((c) => {
      const v = String(c.props.value ?? "");
      return { id: v || EMPTY_SELECT_KEY, value: v, text: Children.toArray(c.props.children).join("") };
    });
  return (
    <SelectView
      {...rest}
      items={items}
      value={String(value)}
      onValueChange={(v) => onChange({ target: { value: v } })}
      label={rest["aria-label"]}
      labelHidden
      triggerId={id}
      isDisabled={rest.isDisabled ?? disabled}
      isRequired={rest.isRequired ?? required}
    />
  );
}

/**
 * Choix de fichier : bouton HeroUI qui ouvre l'entrée fichier native (masquée, libellée par `Field`).
 * Affiche le nom du fichier retenu, ou `emptyLabel`.
 */
export function FileInput({
  id,
  accept,
  file,
  onChange,
  emptyLabel = "Aucun fichier choisi",
  buttonLabel = "Choisir un fichier",
  "aria-describedby": describedBy,
}: {
  id?: string;
  accept?: string;
  file: File | null | undefined;
  onChange: (file: File | undefined) => void;
  emptyLabel?: string;
  buttonLabel?: string;
  "aria-describedby"?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-dashed border-border bg-surface-secondary px-3 py-2.5">
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0])}
      />
      <Btn variant="secondary" size="sm" onClick={() => input.current?.click()}>
        {buttonLabel}
      </Btn>
      <span className="min-w-0 truncate text-[13px] text-muted">{file ? file.name : emptyLabel}</span>
    </div>
  );
}

/** Case à cocher HeroUI : toutes les propriétés de `Checkbox`. Raccourcis : `checked`, `onChange(boolean)`, `disabled`, `hint`. */
export function Check({
  checked,
  onChange,
  children,
  hint,
  disabled,
  className,
  ...rest
}: Omit<ComponentProps<typeof Checkbox>, "children" | "onChange" | "isSelected"> & {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Checkbox
      isSelected={checked}
      isDisabled={rest.isDisabled ?? disabled}
      onChange={onChange}
      className={cx("rounded-lg", typeof className === "string" ? className : undefined)}
      {...rest}
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

/** Puce d'état HeroUI : toutes les propriétés de `Chip` ; `tone` choisit la couleur (taille « sm » et variante « soft » par défaut). */
export function Tag({
  tone = "neutral",
  children,
  icon,
  className,
  size = "sm",
  variant = "soft",
  ...rest
}: Omit<ComponentProps<typeof Chip>, "color" | "children"> & {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const color = tone === "accent" || tone === "success" || tone === "warning" || tone === "danger" ? tone : "default";
  return (
    <Chip
      size={size}
      variant={variant}
      color={color}
      className={cx("whitespace-nowrap", tone === "agent" && "chip--agent", tone === "muted" && "text-muted", typeof className === "string" ? className : undefined)}
      {...rest}
    >
      {icon}
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  );
}

/** Message de réussite ou d'information (`Alert` HeroUI, toutes ses propriétés ; `tone` choisit le statut). */
export function Notice({
  tone = "success",
  children,
  className,
  ...rest
}: Omit<ComponentProps<typeof Alert>, "status"> & { tone?: "success" | "info" | "warning" }) {
  return (
    <Alert role="status" status={tone === "info" ? "accent" : tone} className={cx("px-3 py-2 text-[13px]", typeof className === "string" ? className : undefined)} {...rest}>
      <Alert.Content>{children}</Alert.Content>
    </Alert>
  );
}

/** Message d'erreur (`Alert` HeroUI danger, toutes ses propriétés). */
export function ErrorText({ children, className, ...rest }: Omit<ComponentProps<typeof Alert>, "status">) {
  return (
    <Alert role="alert" status="danger" className={cx("px-3 py-2 text-[13px]", typeof className === "string" ? className : undefined)} {...rest}>
      <Alert.Content>{children}</Alert.Content>
    </Alert>
  );
}
