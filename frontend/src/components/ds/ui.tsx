"use client";

import { Skeleton as HeroSkeleton } from "@heroui/react";
import type { ApiError } from "@/lib/api";
import { isDemoEmail } from "@/lib/labels";
import { DemoChip } from "./badges";
import { ErrorState } from "./layout";

type SkeletonShape = "lines" | "rows" | "cards";

/** Silhouette du contenu à venir (squelette HeroUI) : lignes de texte, lignes de liste ou cartes. */
export function Skeleton({ shape = "lines" }: { shape?: SkeletonShape }) {
  const count = shape === "lines" ? 3 : shape === "rows" ? 5 : 4;
  return (
    <div
     
      className={
        shape === "cards"
          ? "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          : "flex flex-col gap-3"
      }
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Chargement…</span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={
            shape === "lines"
              ? "flex"
              : "flex items-center gap-3 rounded-lg bg-surface p-4 shadow-surface"
          }
        >
          {shape === "rows" && <HeroSkeleton className="size-8 shrink-0 rounded-full" />}
          <span className="flex flex-1 flex-col gap-2">
            <HeroSkeleton className={`h-3 rounded-lg ${shape === "lines" ? (i === count - 1 ? "w-2/5" : "w-4/5") : "w-3/5"}`} />
            {shape !== "lines" && <HeroSkeleton className="h-2.5 w-2/5 rounded-lg" />}
            {shape === "cards" && <HeroSkeleton className="h-6 w-1/4 rounded-lg" />}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Loading({
  loading,
  error,
  onRetry,
  shape = "lines",
}: {
  loading: boolean;
  error: ApiError | null;
  onRetry?: () => void;
  shape?: SkeletonShape;
}) {
  if (loading) return <Skeleton shape={shape} />;
  if (error)
    return (
      <div>
        <ErrorState message={error.message} onRetry={onRetry} />
      </div>
    );
  return null;
}

export function DemoBadge({ email }: { email: string | null | undefined }) {
  return isDemoEmail(email) ? <DemoChip /> : null;
}

export { HeatMeter, LevelBadge, ScoreBadge, StageBadge } from "./badges";

