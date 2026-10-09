import Link from "next/link";
import type { ApiError } from "@/lib/api";
import { LEVELS, STAGES, label } from "@/lib/labels";

export function Loading({ loading, error }: { loading: boolean; error: ApiError | null }) {
  if (loading) return <p className="muted">Chargement…</p>;
  if (error) return <p className="error">{error.message}</p>;
  return null;
}

export function StageBadge({ stage }: { stage: string }) {
  return <span className={`badge stage-${stage}`}>{label(STAGES, stage)}</span>;
}

export function ScoreBadge({ total, level }: { total: number; level?: string | null }) {
  return (
    <span className={`badge level-${level ?? "cold"}`}>
      {total}
      {level ? ` · ${label(LEVELS, level)}` : ""}
    </span>
  );
}

export function ProspectLink({ id, children }: { id: number; children: React.ReactNode }) {
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
      <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        ← Précédent
      </button>
      <span className="muted">
        {from}-{to} sur {total}
      </span>
      <button disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Suivant →
      </button>
    </div>
  );
}
