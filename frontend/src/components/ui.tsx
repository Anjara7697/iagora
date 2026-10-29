import Link from "next/link";
import type { ApiError } from "@/lib/api";
import { isDemoEmail } from "@/lib/labels";
import { DemoChip } from "./ds/badges";

export type SkeletonShape = "lines" | "rows" | "cards";

/** Silhouette du contenu à venir : lignes de texte, lignes de liste ou cartes. */
export function Skeleton({ shape = "lines" }: { shape?: SkeletonShape }) {
  const count = shape === "lines" ? 3 : shape === "rows" ? 5 : 4;
  return (
    <div
      className={`ui-skeleton skeleton-${shape}`}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Chargement…</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-item" aria-hidden="true" key={i}>
          {shape === "rows" && <span className="skeleton-avatar" />}
          <span className="skeleton-text">
            <span className="skeleton-bar" />
            {shape !== "lines" && <span className="skeleton-bar short" />}
            {shape === "cards" && <span className="skeleton-bar tiny" />}
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
      <div className="error" role="alert">
        {error.message}
        {onRetry && (
          <>
            {" "}
            <button onClick={onRetry}>Réessayer</button>
          </>
        )}
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
    <div className="pager">
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        ← Précédent
      </button>
      <span className="muted">
        {from}-{to} sur {total}
      </span>
      <button
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Suivant →
      </button>
    </div>
  );
}
