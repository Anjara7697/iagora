"use client";

import { Skeleton as HeroSkeleton } from "@heroui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ApiError } from "@/lib/api";
import { isDemoEmail } from "@/lib/labels";
import { DemoChip } from "./ds/badges";
import { Btn } from "./ds/controls";
import { ErrorState } from "./ds/layout";

export type SkeletonShape = "lines" | "rows" | "cards";

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
              : "flex items-center gap-3 rounded-xl bg-surface p-4 shadow-surface"
          }
        >
          {shape === "rows" && <HeroSkeleton className="size-8 shrink-0 rounded-full" />}
          <span className="flex flex-1 flex-col gap-2">
            <HeroSkeleton className={`h-3 rounded-md ${shape === "lines" ? (i === count - 1 ? "w-2/5" : "w-4/5") : "w-3/5"}`} />
            {shape !== "lines" && <HeroSkeleton className="h-2.5 w-2/5 rounded-md" />}
            {shape === "cards" && <HeroSkeleton className="h-6 w-1/4 rounded-md" />}
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

export { HeatMeter, LevelBadge, ScoreBadge, StageBadge } from "./ds/badges";

export function ProspectLink({
  id,
  children,
}: {
  id: number;
  children: React.ReactNode;
}) {
  return <Link href={`/prospects/${id}`}>{children}</Link>;
}

export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      <Btn size="sm" variant="ghost" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Précédent
      </Btn>
      <span className="font-mono text-[13px] text-muted tabular-nums">
        {from}-{to} sur {total}
      </span>
      <Btn size="sm" variant="ghost" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Suivant
        <ChevronRight className="size-4" aria-hidden="true" />
      </Btn>
    </div>
  );
}
