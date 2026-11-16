"use client";

import { Chip } from "@heroui/react";
import { FlaskConical } from "lucide-react";
import { LEVELS, STAGES, label } from "@/lib/labels";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * Familles de pastilles (DESIGN_SYSTEM.md §6, règle 10) : statut (douce, une couleur sémantique), étape (douce, agent
 * ou neutre), mesure (texte et jauge, sans fond ; « Très chaud », seule pastille pleine), marque (contour).
 * Étape : couleur de l'agent quand c'est lui qui mène l'échange, orange quand une relance est due, neutre sinon.
 */
type Tone = "neutral" | "muted" | "agent" | "accent" | "success" | "warning" | "danger";
const STAGE_TONE: Record<string, Tone> = {
  new: "neutral",
  to_qualify: "neutral",
  contacted: "neutral",
  in_conversation: "agent",
  qualified: "agent",
  meeting_proposed: "neutral",
  meeting_scheduled: "neutral",
  meeting_done: "neutral",
  applied: "neutral",
  converted: "neutral",
  to_follow_up: "warning",
  lost: "muted",
};
const TONE_CHIP: Record<Tone, { color: "default" | "accent" | "success" | "warning" | "danger"; className?: string }> = {
  neutral: { color: "default" },
  muted: { color: "default", className: "text-muted" },
  agent: { color: "default", className: "chip--agent" },
  accent: { color: "accent" },
  success: { color: "success" },
  warning: { color: "warning" },
  danger: { color: "danger" },
};

/** Étape du parcours d'un prospect (famille « étape »). */
export function StageBadge({ stage }: { stage: string }) {
  const tone = TONE_CHIP[STAGE_TONE[stage] ?? "neutral"];
  return (
    <Chip size="sm" variant="soft" color={tone.color} className={tone.className}>
      <Chip.Label>{label(STAGES, stage)}</Chip.Label>
    </Chip>
  );
}

const LEVEL_STEP: Record<string, number> = { cold: 1, warm: 2, hot: 3, very_hot: 4 };
const LEVEL_FILL: Record<string, string> = {
  cold: "bg-level-cold",
  warm: "bg-level-warm",
  hot: "bg-level-hot",
  very_hot: "bg-level-very-hot",
};

/** Quatre barres remplies selon le niveau d'intérêt. Décoratives : le mot voisin porte le sens. */
export function HeatMeter({ level, onFill }: { level: string; onFill?: boolean }) {
  const n = LEVEL_STEP[level] ?? 0;
  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cx(
            "w-[3px] rounded-full",
            onFill
              ? i < n
                ? "bg-level-very-hot-foreground"
                : "bg-level-very-hot-foreground/40"
              : i < n
                ? LEVEL_FILL[level]
                : "bg-surface-tertiary",
          )}
          style={{ height: 5 + i * 2 }}
        />
      ))}
    </span>
  );
}

/** « Très chaud » : seule pastille pleine de l'échelle d'intérêt. */
function VeryHot({ children }: { children: React.ReactNode }) {
  return (
    <Chip size="sm" variant="primary" color="default" className="chip--very-hot">
      {children}
    </Chip>
  );
}

/** Mesure sans fond (famille « mesure ») : le texte et la jauge suffisent. */
const MEASURE = "inline-flex items-center gap-1.5 whitespace-nowrap type-caption font-medium text-foreground";

/** Niveau d'intérêt seul (sans score), avec sa jauge. Jamais rouge : le rouge signale un blocage. */
export function LevelBadge({ level }: { level: string }) {
  if (level === "very_hot")
    return (
      <VeryHot>
        <HeatMeter level={level} onFill />
        <Chip.Label>{label(LEVELS, level)}</Chip.Label>
      </VeryHot>
    );
  return (
    <span className={MEASURE}>
      <HeatMeter level={level} />
      {label(LEVELS, level)}
    </span>
  );
}

/** Score commercial en chiffres tabulaires, suivi du niveau d'intérêt quand il est connu. */
export function ScoreBadge({ total, level }: { total: number; level?: string | null }) {
  if (level === "very_hot")
    return (
      <VeryHot>
        <span className="tabular-nums">{total}</span>
        <HeatMeter level={level} onFill />
        <Chip.Label>{label(LEVELS, level)}</Chip.Label>
      </VeryHot>
    );
  return (
    <span className={MEASURE}>
      <span className="tabular-nums">{total}</span>
      {level && <HeatMeter level={level} />}
      {level && <span className="font-normal text-muted">{label(LEVELS, level)}</span>}
    </span>
  );
}

/** Prospect fictif : aucun message réel ne lui est envoyé (famille « marque » : contour). */
export function DemoChip() {
  return (
    <Chip
      size="sm"
      variant="tertiary"
      color="default"
      className="border border-border text-muted"
      title="Prospect fictif : aucun message réel ne lui est envoyé"
    >
      <FlaskConical className="size-3" aria-hidden="true" />
      <Chip.Label>Fictif</Chip.Label>
    </Chip>
  );
}
