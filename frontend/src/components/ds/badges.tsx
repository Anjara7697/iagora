"use client";

import { Chip } from "@heroui/react";
import { CircleDot, FlaskConical } from "lucide-react";
import { LEVELS, STAGES, label } from "@/lib/labels";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Qui agit ensuite : neutre (rien n'a commencé), agent, rendez-vous, terminé, à relancer, désinscrit. */
type Tone = "neutral" | "muted" | "agent" | "accent" | "success" | "warning" | "danger";
const STAGE_TONE: Record<string, Tone> = {
  new: "neutral",
  to_qualify: "neutral",
  contacted: "neutral",
  in_conversation: "agent",
  qualified: "agent",
  meeting_proposed: "accent",
  meeting_scheduled: "accent",
  meeting_done: "success",
  applied: "success",
  converted: "success",
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

/** Étape du parcours d'un prospect (puce douce colorée selon qui agit ensuite). */
export function StageBadge({ stage }: { stage: string }) {
  const tone = TONE_CHIP[STAGE_TONE[stage] ?? "neutral"];
  return (
    <Chip size="sm" variant="soft" color={tone.color} className={tone.className}>
      <CircleDot className="size-3" aria-hidden="true" />
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

/** Niveau d'intérêt seul (sans score), avec sa jauge. Jamais rouge : le rouge signale un blocage. */
export function LevelBadge({ level }: { level: string }) {
  const veryHot = level === "very_hot";
  return (
    <Chip
      size="sm"
      variant={veryHot ? "primary" : "soft"}
      color="default"
      className={veryHot ? "chip--very-hot" : undefined}
    >
      <HeatMeter level={level} onFill={veryHot} />
      <Chip.Label>{label(LEVELS, level)}</Chip.Label>
    </Chip>
  );
}

/** Score commercial, en chiffres mono, suivi du niveau d'intérêt quand il est connu. */
export function ScoreBadge({ total, level }: { total: number; level?: string | null }) {
  const veryHot = level === "very_hot";
  return (
    <Chip
      size="sm"
      variant={veryHot ? "primary" : "soft"}
      color="default"
      className={veryHot ? "chip--very-hot" : undefined}
    >
      <span className="font-mono tabular-nums">{total}</span>
      {level && <HeatMeter level={level} onFill={veryHot} />}
      {level && <Chip.Label>{label(LEVELS, level)}</Chip.Label>}
    </Chip>
  );
}

/** Prospect fictif : aucun message réel ne lui est envoyé. */
export function DemoChip() {
  return (
    <Chip
      size="sm"
      variant="soft"
      color="warning"
      title="Prospect fictif : aucun message réel ne lui est envoyé"
    >
      <FlaskConical className="size-3" aria-hidden="true" />
      <Chip.Label>Fictif</Chip.Label>
    </Chip>
  );
}
