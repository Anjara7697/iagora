"use client";

/** Détail d'une décision prise dans les 24 dernières heures : trace, état d'envoi et nouvelle tentative. */

import { toast } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Btn, ErrorText, LinkButton, Tag } from "@/components/ds/controls";
import { Eyebrow } from "@/components/ds/layout";
import { DemoBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CHANNELS, formatDate, fullName, label, EXECUTION } from "@/lib/labels";
import type { TreatedItem } from "@/lib/types";
import { Box } from "@/components/ds/card";
import { revealed, EXECUTION_HELP, EXECUTION_TONE, DetailHead } from "@/components/todo/shared";

export function TreatedDetail({
  item,
  onChanged,
  refreshing,
}: {
  item: TreatedItem;
  onChanged: () => void;
  refreshing: boolean;
}) {
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageId = item.id.split(":")[2];
  const name = item.prospect
    ? fullName(item.prospect) || item.prospect.email || "Prospect"
    : "Prospect";
  const canRetry =
    item.decision === "approved" &&
    (item.execution === "failed" || item.execution === "blocked") &&
    user?.role !== "VIEWER";

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await api(
        `/conversations/${item.conversation_id}/messages/${messageId}/retry-delivery`,
        {
          method: "POST",
        },
      );
      toast.success("Nouvelle tentative demandée", {
        description: `${name} : l’état d’envoi se met à jour ici.`,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-[980px] min-w-0 flex-1 flex-col gap-4" aria-label={`Traité : ${name}`}>
      <DetailHead
        name={name}
        chips={
          <>
            <DemoBadge email={item.prospect?.email} />
            <Tag tone={item.decision === "approved" ? "success" : "neutral"}>
              {item.decision === "approved" ? "Validé" : "Refusé"}
              {item.edited ? " (modifié)" : ""}
            </Tag>
            <span className="text-xs text-muted">{formatDate(item.decided_at)}</span>
          </>
        }
        action={
          <LinkButton variant="outline" size="sm" href={`/conversations?id=${item.conversation_id}`}>
            Ouvrir la conversation
          </LinkButton>
        }
      />
      <Box as="section" aria-label="État d’envoi" {...revealed(1, "gap-3 p-5")}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <Eyebrow>État d’envoi</Eyebrow>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <span
                className={`size-2 rounded-full ${
                  EXECUTION_TONE[item.execution] === "success"
                    ? "bg-success"
                    : EXECUTION_TONE[item.execution] === "danger"
                      ? "bg-danger"
                      : EXECUTION_TONE[item.execution] === "accent"
                        ? "bg-accent"
                        : "bg-muted"
                }`}
                aria-hidden="true"
              />
              {label(EXECUTION, item.execution)}
            </h3>
          </div>
          <Btn size="sm" disabled={busy || refreshing} onClick={onChanged}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {refreshing ? "Actualisation…" : "Actualiser l’état"}
          </Btn>
        </div>
        <p className="text-sm text-foreground">{EXECUTION_HELP[item.execution]}</p>
        {item.reason && <p className="text-sm text-foreground">Motif du refus : {item.reason}</p>}
        {item.execution_detail && (
          <p className="rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">{item.execution_detail}</p>
        )}
        {canRetry && (
          <div>
            <Btn variant="primary" disabled={busy || refreshing} onClick={retry}>
              {busy ? "Nouvelle tentative…" : "Réessayer l’envoi"}
            </Btn>
          </div>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </Box>
      <Box as="section" aria-label="Message traité" {...revealed(2, "gap-0 overflow-hidden p-0")}>
        <header className="border-b border-separator px-5 py-3.5">
          <strong className="text-sm font-semibold text-foreground">Message — {label(CHANNELS, item.channel)}</strong>
        </header>
        <div className="px-5 py-4 text-sm/6 whitespace-pre-wrap text-foreground">{item.content}</div>
      </Box>
    </section>
  );
}
