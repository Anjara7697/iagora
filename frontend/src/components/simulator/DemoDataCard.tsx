"use client";

import { Database, Trash2 } from "lucide-react";
import { Box } from "@/components/ds/card";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn } from "@/components/ds/controls";

/** Données fictives en base et leur suppression, confirmée (administrateur ; règles 14 et 19). */
export function DemoDataCard({
  counts,
  unavailable,
  disabled,
  onPurge,
}: {
  counts: { prospects: number; conversations: number } | null;
  unavailable: boolean;
  disabled: boolean;
  onPurge: () => void;
}) {
  return (
    <Box as="section" className="gap-3 p-5" aria-label="Données fictives">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-muted" aria-hidden="true">
          <Database className="size-4" />
        </span>
        <span className="min-w-[180px] flex-1 text-[13px]/[20px] text-muted" role="status">
          Données fictives en base
          {counts && (
            <>
              {" : "}
              <b className="font-semibold text-foreground">
                {`${counts.prospects} prospect(s), ${counts.conversations} conversation(s)`}
              </b>
            </>
          )}
          {unavailable && " : nombre indisponible"}
        </span>
        <ConfirmDialog
          trigger={
            <Btn variant="danger-soft" size="sm" disabled={disabled}>
              <Trash2 className="size-4" aria-hidden="true" />
              Supprimer les données fictives
            </Btn>
          }
          title="Supprimer les données fictives ?"
          description="Tous les prospects fictifs (@demo.example.com) et leurs conversations sont supprimés. Les vraies données ne sont pas touchées."
          confirmLabel="Supprimer les données fictives"
          onConfirm={onPurge}
        />
      </div>
    </Box>
  );
}
