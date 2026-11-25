"use client";

/**
 * Doublons à trancher : deux fiches que les identifiants d'un même lead relient (l'email sur l'une, le téléphone sur
 * l'autre). Rien n'est fusionné automatiquement : on garde l'une des deux fiches (l'autre lui est rattachée puis
 * supprimée) ou on les déclare distinctes. Panneau latéral ouvert depuis la liste des prospects ou depuis une fiche.
 */

import { toast } from "@heroui/react";
import { CopyCheck, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Drawer } from "@/components/ds/Drawer";
import { Btn, ErrorText, Notice } from "@/components/ds/controls";
import { EmptyPanel } from "@/components/ds/layout";
import { Loading } from "@/components/ds/ui";
import { api, ApiError, qs } from "@/lib/api";
import { CONSENT, formatDate, fullName, label } from "@/lib/labels";
import type { DuplicatePair, Page } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Sheet = DuplicatePair["prospects"][number];

const FIELDS: Record<string, string> = {
  email: "email",
  phone: "téléphone",
  linkedin_id: "LinkedIn",
  facebook_id: "Facebook",
  instagram_id: "Instagram",
};

/** Nombre de doublons à trancher (toute la file, ou ceux d'une fiche) ; `null` tant qu'il n'est pas chargé. */
export function useDuplicateCount(prospectId?: number) {
  const { data, reload } = useApi<Page<DuplicatePair>>(`/duplicates${qs({ prospect_id: prospectId, limit: 1 })}`);
  return { count: data ? data.total : null, reload };
}

function SheetCard({ sheet }: { sheet: Sheet }) {
  const rows: [string, string | null][] = [
    ["Email", sheet.email],
    ["Téléphone", sheet.phone],
    ["LinkedIn", sheet.linkedin_id],
    ["Facebook", sheet.facebook_id],
    ["Instagram", sheet.instagram_id],
  ];
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-separator bg-surface p-4">
      <Link href={`/prospects/${sheet.id}`} className="type-body font-semibold text-foreground hover:underline">
        {fullName(sheet)}
      </Link>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 type-body-sm">
        {rows
          .filter(([, value]) => value)
          .map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-muted">{name}</dt>
              <dd className="min-w-0 break-words text-foreground">{value}</dd>
            </div>
          ))}
        <dt className="text-muted">Consentement</dt>
        <dd className="text-foreground">{label(CONSENT, sheet.consent_status)}</dd>
        <dt className="text-muted">Créée le</dt>
        <dd className="text-foreground">{formatDate(sheet.created_at)}</dd>
      </dl>
      <p className="type-body-sm text-muted">Fiche n° {sheet.id}</p>
    </div>
  );
}

function PairCard({
  pair,
  readOnly,
  onDone,
}: {
  pair: DuplicatePair;
  readOnly: boolean;
  onDone: (keptId: number | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = pair.matched_fields.map((f) => FIELDS[f] ?? f);
  const optedOut = pair.prospects.some((p) => p.consent_status === "opted_out");

  async function act(path: string, body: unknown, done: string, keptId: number | null) {
    setBusy(true);
    setError(null);
    try {
      await api(`/duplicates/${pair.id}/${path}`, { method: "POST", body });
      toast.success(done);
      onDone(keptId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action impossible");
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 border-b border-separator pb-5 last:border-b-0">
      <p className="type-body-sm text-muted">
        Un même message portait {shared.length ? `l’identifiant ${shared.join(" et ")}` : "des identifiants"} des deux
        fiches. Signalé le {formatDate(pair.created_at)}.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {pair.prospects.map((sheet) => (
          <SheetCard key={sheet.id} sheet={sheet} />
        ))}
      </div>
      {optedOut && (
        <Notice tone="warning">L’une des fiches est désinscrite : la fiche fusionnée le sera aussi.</Notice>
      )}
      {error && <ErrorText>Décision non enregistrée : {error}</ErrorText>}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {pair.prospects.map((keep) => {
            const gone = pair.prospects.find((p) => p.id !== keep.id)!;
            return (
              <ConfirmDialog
                key={keep.id}
                trigger={
                  <Btn variant="secondary" disabled={busy}>
                    Garder {fullName(keep)} (n° {keep.id})
                  </Btn>
                }
                status="warning"
                title={`Fusionner dans la fiche n° ${keep.id} ?`}
                description={`La fiche n° ${gone.id} est supprimée : ses identifiants manquants, son profil, ses campagnes, ses conversations, ses rendez-vous, ses relances et son historique sont rattachés à la fiche n° ${keep.id}. Cette fusion ne peut pas être défaite.`}
                cancelLabel="Annuler"
                confirmLabel="Fusionner"
                onConfirm={() =>
                  void act("merge", { keep_prospect_id: keep.id }, `Fiches fusionnées dans la fiche n° ${keep.id}`, keep.id)
                }
              />
            );
          })}
          <Btn variant="tertiary" disabled={busy} onClick={() => void act("distinct", undefined, "Fiches gardées séparées", null)}>
            Deux personnes distinctes
          </Btn>
        </div>
      )}
    </li>
  );
}

export function DuplicatesPanel({
  open,
  onClose,
  prospectId,
  readOnly = false,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** Observateur : les paires sont visibles, sans décision possible. */
  readOnly?: boolean;
  /** Seulement les doublons de cette fiche. */
  prospectId?: number;
  /** Appelé après chaque décision, avec la fiche gardée après une fusion (`null` : fiches distinctes). */
  onChanged?: (keptId: number | null) => void;
}) {
  const { data, error, loading, reload } = useApi<Page<DuplicatePair>>(
    open ? `/duplicates${qs({ prospect_id: prospectId, limit: 50 })}` : null,
  );
  return (
    <Drawer open={open} onClose={onClose} eyebrow="Prospects" title="Doublons à trancher" icon={<CopyCheck aria-hidden="true" />}>
      <Loading loading={loading && !data} error={error} onRetry={reload} shape="rows" />
      {data &&
        (data.items.length === 0 ? (
          <EmptyPanel icon={Users} title="Aucun doublon à trancher" description="Les fiches reliées par un même lead apparaîtront ici." />
        ) : (
          <div className="flex flex-col gap-5">
            <p className="type-body-sm text-muted">
              Rien n’est fusionné sans votre décision : un téléphone ou une adresse partagés peuvent appartenir à deux
              personnes.
            </p>
            <ul className="flex flex-col gap-5">
              {data.items.map((pair) => (
                <PairCard
                  key={pair.id}
                  pair={pair}
                  readOnly={readOnly}
                  onDone={(keptId) => {
                    reload();
                    onChanged?.(keptId);
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
    </Drawer>
  );
}
