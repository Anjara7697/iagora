"use client";

import { DateField, DateRangePicker, Description, Label, RangeCalendar } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import { useId, type ComponentProps, type ReactNode } from "react";

/**
 * Période (début et fin) : `DateRangePicker` HeroUI avec champ à segments et calendrier de plage.
 * Les dates se lisent et s'écrivent en `AAAA-MM-JJ` (format de l'API) ; une période incomplète vaut deux chaînes vides.
 * Accepte les propriétés du `DateRangePicker` (isRequired, minValue, isDisabled…) et `variant` du champ.
 */
export function DateRangeField({
  label,
  hint,
  start,
  end,
  onChange,
  variant,
  fullWidth = true,
  ...rest
}: Omit<ComponentProps<typeof DateRangePicker>, "value" | "defaultValue" | "onChange" | "children"> & {
  label: string;
  hint?: ReactNode;
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  variant?: "primary" | "secondary";
  fullWidth?: boolean;
}) {
  const hintId = useId();
  return (
    <DateRangePicker
      value={start && end ? { start: parseDate(start), end: parseDate(end) } : null}
      onChange={(range) => onChange(range ? range.start.toString() : "", range ? range.end.toString() : "")}
      aria-describedby={hint ? hintId : undefined}
      {...rest}
    >
      <Label>{label}</Label>
      <DateField.Group fullWidth={fullWidth} variant={variant}>
        <DateField.Input slot="start">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
        <DateRangePicker.RangeSeparator />
        <DateField.Input slot="end">{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
        <DateField.Suffix>
          <DateRangePicker.Trigger>
            <DateRangePicker.TriggerIndicator />
          </DateRangePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      {hint && <Description id={hintId}>{hint}</Description>}
      <DateRangePicker.Popover>
        <RangeCalendar aria-label={label}>
          <RangeCalendar.Header>
            <RangeCalendar.NavButton slot="previous" />
            <RangeCalendar.Heading />
            <RangeCalendar.NavButton slot="next" />
          </RangeCalendar.Header>
          <RangeCalendar.Grid>
            <RangeCalendar.GridHeader>{(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader>
            <RangeCalendar.GridBody>{(date) => <RangeCalendar.Cell date={date} />}</RangeCalendar.GridBody>
          </RangeCalendar.Grid>
        </RangeCalendar>
      </DateRangePicker.Popover>
    </DateRangePicker>
  );
}
