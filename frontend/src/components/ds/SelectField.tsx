"use client";

import { Label, ListBox, Select } from "@heroui/react";

/** Champ de sélection HeroUI partagé, avec option vide explicite. */
export function SelectField({ label, value, options, onChange, disabled, className }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const empty = "__empty__";
  const items = options.map((o) => ({ ...o, id: o.value || empty }));
  return (
    <Select<(typeof items)[number]>
      className={className}
      fullWidth
      isDisabled={disabled}
      selectedKey={value || empty}
      onSelectionChange={(key) => { if (key !== null) onChange(key === empty ? "" : String(key)); }}
    >
      <Label>{label}</Label>
      <Select.Trigger className="rounded-lg" data-value={value}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="rounded-lg">
        <ListBox items={items}>
          {(item) => <ListBox.Item id={item.id} textValue={item.label} data-value={item.value}>
            <Label>{item.label}</Label><ListBox.ItemIndicator />
          </ListBox.Item>}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
