"use client";

/**
 * Premiers contacts d'une campagne (décision D-29) : combien de personnes l'agent peut aborder, pourquoi les
 * autres non, et l'action qui prépare leurs premiers messages. En mode assisté, chaque message devient un
 * brouillon « Premier contact » dans « À traiter » : rien ne part sans relecture. Affiché dans l'onglet Prospects
 * de la campagne et à la fin d'un import.
 */

import { Skeleton, toast } from "@heroui/react";
import { Send, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { Box } from "@/components/ds/card";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, LinkButton, Notice } from "@/components/ds/controls";
import { ErrorState } from "@/components/ds/layout";
import { api, failure, qs } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { AgentMode, Campaign, FirstContacts as Plan } from "@/lib/types";

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
const contacts = (n: number) => (n > 1 ? `${n} premiers contacts` : `${n} premier contact`);

export function FirstContacts({ campaign, showImport = true }: { campaign: Campaign; showImport?: boolean }) {
  const router = useRouter();
  const user = useCurrentUser();
  const plan = useApi<Plan>(`/campaigns/${campaign.id}/first-contacts`);
  const mode = useApi<{ mode: AgentMode }>("/agent/mode");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const canWrite = user?.role === "ADMIN" || user?.role === "ADVISOR";
  const importSource = campaign.sources.find((s) => s.type === "import") ?? campaign.sources[0];
  const p = plan.data;
  const n = p?.eligible ?? 0;
  const auto = mode.data?.mode === "auto";

  async function prepare() {
    setBusy(true);
    try {
      const result = await api<Plan>(`/campaigns/${campaign.id}/first-contacts`, { method: "POST" });
      toast.success(`${contacts(result.queued)} en préparation`, {
        description: auto
          ? "Mode automatique : ils partiront sans relecture, dans la fenêtre d’envoi."
          : "L’agent les rédige en arrière-plan ; ils arrivent dans « À traiter » pour relecture.",
        actionProps: auto
          ? undefined
          : { children: "Ouvrir À traiter", onPress: () => router.push("/todo?kind=first_contact") },
      });
      plan.reload();
    } catch (e) {
      toast.danger(failure("Préparation des premiers contacts impossible", e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const excluded = p
    ? [
        p.without_consent &&
          `${plural(p.without_consent, "personne")} sans consentement (l’agent ne ${p.without_consent > 1 ? "leur" : "lui"} écrit pas)`,
        p.without_email && `${p.without_email} sans adresse email`,
        p.already_contacted && `${p.already_contacted} déjà en échange`,
        p.in_progress && `${p.in_progress} en préparation`,
        p.opted_out && `${p.opted_out} désinscrit${p.opted_out > 1 ? "s" : ""}`,
      ].filter(Boolean)
    : [];

  return (
    <Box as="section" aria-label="Premiers contacts" className="gap-3 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">Premiers contacts</h3>
          {!p && !plan.error ? (
            <Skeleton className="h-4 w-64 rounded-md" />
          ) : (
            p && (
              <p className="text-[13px] text-muted" role="status">
                {n
                  ? `${plural(n, "personne")} de la campagne peu${n > 1 ? "vent" : "t"} recevoir un premier message de l’agent.`
                  : "Personne à aborder pour l’instant."}
              </p>
            )
          )}
          {excluded.length > 0 && <p className="text-xs text-muted">{excluded.join(" · ")}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {showImport && canWrite && (
            <LinkButton
              variant="outline"
              href={`/prospects/import${qs({ campaign: campaign.id, source: importSource?.id })}`}
            >
              <Upload className="size-4" aria-hidden="true" />
              Importer une liste
            </LinkButton>
          )}
          {canWrite && n > 0 && p?.campaign_active && (
            <Btn variant="primary" isDisabled={busy} onClick={() => setConfirming(true)}>
              <Send className="size-4" aria-hidden="true" />
              Préparer {n > 1 ? `les ${n} premiers contacts` : "le premier contact"}
            </Btn>
          )}
        </div>
      </div>
      {plan.error && (
        <ErrorState message={`Premiers contacts indisponibles : ${plan.error.message}`} onRetry={plan.reload} />
      )}
      {p && n > 0 && !p.campaign_active && (
        <Notice tone="warning">Activez la campagne pour préparer les premiers contacts.</Notice>
      )}
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        status="accent"
        title={`Préparer ${contacts(n)} ?`}
        description={
          auto
            ? "Mode automatique : l’agent écrit à chacune et les messages partent sans relecture, étalés dans la fenêtre d’envoi."
            : "L’agent rédige un premier message pour chacune, à partir de la campagne et des informations du fichier. Chaque message arrive dans « À traiter » (Premiers contacts) : rien ne part avant votre validation."
        }
        cancelLabel="Annuler"
        confirmLabel="Préparer"
        confirmDisabled={busy}
        onConfirm={() => void prepare()}
      />
    </Box>
  );
}
