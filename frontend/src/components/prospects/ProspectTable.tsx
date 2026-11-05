"use client";

/** Vue « Table » de la liste des prospects : une ligne par prospect, toute la ligne ouvre la fiche. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, Table } from "@/components/ds/table";
import { DemoBadge, ScoreBadge, StageBadge } from "@/components/ui";
import { formatDate, fullName } from "@/lib/labels";
import type { Membership, Prospect } from "@/lib/types";
import { ConsentTag, ProspectAvatar, level } from "@/components/prospects/shared";

export function ProspectTable({
  items,
  memberships,
  profileHref,
}: {
  items: Prospect[];
  memberships: (p: Prospect) => Membership[];
  profileHref: (id: number) => string;
}) {
  const router = useRouter();
  return (
    <DataTable
      label="Prospects et rattachements aux campagnes"
      minWidth={720}
      columns={[
        { id: "prospect", label: "Prospect" },
        { id: "stages", label: "Étapes et scores" },
        { id: "consent", label: "Consentement" },
        { id: "created", label: "Créé le" },
      ]}
    >
      {items.map((p) => (
        // Toute la ligne ouvre la fiche (clic et Entrée, règle 4) ; le nom reste un lien.
        <Table.Row key={p.id} id={p.id} onAction={() => router.push(profileHref(p.id))} className="cursor-pointer">
          <Table.Cell>
            <div className="flex items-center gap-3">
              <ProspectAvatar prospect={p} />
              <div className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={profileHref(p.id)} className="rounded font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus">
                    {fullName(p)}
                  </Link>
                  <DemoBadge email={p.email} />
                </span>
                <span className="text-xs text-muted">
                  {p.email || p.phone || "—"}
                </span>
              </div>
            </div>
          </Table.Cell>
          <Table.Cell>
            {memberships(p).length ? (
              <div className="flex flex-col gap-1.5">
                {memberships(p).map((m) => (
                  <div key={m.id} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-foreground">
                      {m.campaign_name ?? "Campagne"}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <StageBadge stage={m.conversion_stage} />
                      <ScoreBadge
                        total={m.total_score}
                        level={level(m.total_score)}
                      />
                    </span>
                  </div>
                ))}
                  </div>
                ) : (
                  <span className="text-[13px] text-muted">Sans campagne</span>
                )}
              </Table.Cell>
              <Table.Cell>
                <ConsentTag status={p.consent_status} />
              </Table.Cell>
              <Table.Cell className="text-xs text-muted tabular-nums">
                {formatDate(p.created_at)}
              </Table.Cell>
            </Table.Row>
          ))}
    </DataTable>
  );
}
