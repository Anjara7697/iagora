"use client";

import { Button, Chip, ProgressBar } from "@heroui/react";
import { Check } from "lucide-react";
import { cx } from "./layout";

export type Step = { id: string; title: string; description?: string };

/**
 * Étapes d'un parcours (HeroUI n'a pas de composant `Stepper` : on assemble `ProgressBar`, `Chip` et `Button`).
 * Les étapes passées sont cliquables pour revenir en arrière ; l'étape courante porte `aria-current="step"`.
 */
export function Stepper({
  label,
  steps,
  current,
  onSelect,
  className,
}: {
  label: string;
  steps: Step[];
  /** Rang de l'étape courante, à partir de 0. */
  current: number;
  onSelect?: (index: number) => void;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cx("flex flex-col gap-3", className)}>
      <ProgressBar aria-label={`Étape ${current + 1} sur ${steps.length}`} value={((current + 1) / steps.length) * 100} size="sm">
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step.id}>
              <Button
                variant={active ? "secondary" : "ghost"}
                isDisabled={!done}
                aria-current={active ? "step" : undefined}
                onPress={() => onSelect?.(i)}
                className="h-auto w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-left whitespace-normal disabled:opacity-100"
              >
                <Chip size="sm" variant={active || done ? "primary" : "soft"} color={done ? "success" : active ? "accent" : "default"}>
                  {done ? <Check className="size-3" aria-label="terminée" /> : <Chip.Label>{i + 1}</Chip.Label>}
                </Chip>
                <span className="flex min-w-0 flex-col">
                  <span className="type-body font-medium text-foreground">{step.title}</span>
                  {step.description && <span className="hidden type-caption text-muted sm:block">{step.description}</span>}
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
