"use client";

/** Libellés, tons, types et petits éléments partagés par les écrans « À traiter ». */

import { Avatar } from "@heroui/react";
import { AlertTriangle } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { type Tone } from "@/components/ds/controls";
import { reveal } from "@/components/ds/motion";
import { fullName, initials } from "@/lib/labels";
import type { TodoItem, TodoKind, TreatedItem } from "@/lib/types";

export type KindFilter = "" | TodoKind;
/** Classes d'un bloc et entrée en cascade (`reveal`) réunies. */
export function revealed(index: number, className = "") {
  const motion = reveal(index);
  return { className: `${className} ${motion.className}`.trim(), style: motion.style };
}
/** Éléments par page de la file. */
export const PAGE_SIZE = 50;
/** Résultat d'une décision, annoncé par un Toast : `treatedId` ajoute « Voir la décision ». */
export type DecisionResult = { title: string; description: string; treatedId?: string };
/** Ce que reçoit chaque panneau de décision : la fin du traitement, le signal « saisie modifiée » et la garde. */
export type PanelProps = {
  item: TodoItem;
  onDone: (result: DecisionResult) => void;
  onDirtyChange: (dirty: boolean) => void;
  guard: (action: () => void) => void;
};

/** Signale à la page qu'une saisie du panneau n'est pas enregistrée (et plus rien quand le panneau disparaît). */
export function useReportDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void) {
  useLayoutEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
}
export const EXECUTION_HELP: Record<TreatedItem["execution"], string> = {
  approved: "La réponse est validée, mais aucun envoi n’est encore confirmé.",
  sending: "L’envoi est en cours. Actualisez pour connaître le résultat.",
  sent: "Le service d’envoi confirme que le message a été envoyé.",
  failed: "La tentative d’envoi a échoué. Consultez le détail avant de réessayer.",
  blocked: "L’envoi est bloqué. Corrigez la cause indiquée avant de réessayer.",
  rejected: "Ce brouillon a été refusé ; aucun envoi n’a été demandé.",
};
export const TASK_LABELS: Record<TodoKind, string> = {
  enrollment: "Inscriptions",
  application: "Candidatures",
  validation: "Brouillons à valider",
  first_contact: "Premiers contacts",
  escalation: "Demandes de conseiller",
  kb_gap: "Réponses à compléter",
  incident: "Incidents",
  opt_out_check: "Oppositions à vérifier",
};
export const KIND_ORDER: TodoKind[] = [
  "enrollment",
  "application",
  "validation",
  "first_contact",
  "escalation",
  "kb_gap",
  "incident",
  "opt_out_check",
];

export function itemName(item: TodoItem): string {
  if (item.prospect) return fullName(item.prospect);
  return (
    item.handoff?.identity?.first_name ||
    item.handoff?.identity?.email ||
    "Prospect"
  );
}

export const KIND_TONE: Record<TodoKind, Tone> = {
  enrollment: "success",
  application: "success",
  validation: "warning",
  first_contact: "warning",
  escalation: "accent",
  kb_gap: "agent",
  incident: "danger",
  opt_out_check: "warning",
};
export const PRIORITY_TONE: Record<string, Tone> = {
  critical: "danger",
  high: "warning",
  medium: "neutral",
  low: "muted",
};
export const RISK_TONE: Record<string, Tone> = { low: "success", medium: "warning", high: "danger" };
export const EXECUTION_TONE: Record<string, Tone> = {
  approved: "accent",
  sending: "accent",
  sent: "success",
  failed: "danger",
  blocked: "danger",
  rejected: "neutral",
};

export function Confidence({ value }: { value: number | null }) {
  if (value === null) return <p className="text-sm text-muted">Non évaluée</p>;
  const percent = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2" aria-label={`Confiance ${percent} %`}>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-tertiary" aria-hidden="true">
        <span
          className={`block h-full rounded-full ${value < 0.6 ? "bg-warning" : "bg-agent"}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-[13px] text-foreground tabular-nums">{percent} %</span>
    </div>
  );
}

export function PersonMark({ name, incident }: { name: string; incident?: boolean }) {
  return incident ? (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger-soft-foreground" aria-hidden="true">
      <AlertTriangle className="size-4" />
    </span>
  ) : (
    <Avatar size="sm" variant="soft" color="accent" aria-hidden="true">
      <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
    </Avatar>
  );
}

export function DetailHead({
  name,
  incident,
  chips,
  action,
  autoFocus = false,
}: {
  name: string;
  incident?: boolean;
  chips: React.ReactNode;
  action?: React.ReactNode;
  /** Après une décision, le focus passe sur le titre de l'élément suivant (lu par les lecteurs d'écran). */
  autoFocus?: boolean;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) title.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <header {...revealed(0, "flex flex-wrap items-start gap-3")}>
      <PersonMark name={name} incident={incident} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 ref={title} tabIndex={-1} className="text-xl font-semibold tracking-[-0.01em] text-foreground outline-none">
          {name}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      </div>
      {action}
    </header>
  );
}
