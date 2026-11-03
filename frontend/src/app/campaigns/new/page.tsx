"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import CampaignForm, {
  EMPTY_VALUES,
  type CampaignValues,
} from "@/components/CampaignForm";
import { useCurrentUser } from "@/components/AppShell";
import { TextLink } from "@/components/ds/controls";
import { PageHeader, Screen } from "@/components/ds/layout";
import { Loading } from "@/components/ui";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { toast } from "@heroui/react";
import { linkMetaForms } from "@/lib/metaForms";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Campaign, Target } from "@/lib/types";

const toIso = (day: string) => (day ? `${day}T00:00:00Z` : null);

export default function NewCampaignPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const targets = useApi<Target[]>("/targets");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  // Pas d'avertissement une fois la campagne créée : la redirection vers sa fiche n'abandonne rien.
  const { guard, dialog } = useDiscardGuard(() => dirty.current && !busy);

  if (user && user.role !== "ADMIN") {
    return (
      <Screen className="max-w-[960px]">
        <PageHeader title="Nouvelle campagne" subtitle="La création de campagnes est réservée aux administrateurs." />
        <TextLink href="/campaigns" className="w-fit">← Retour aux campagnes</TextLink>
      </Screen>
    );
  }

  async function create(v: CampaignValues) {
    setBusy(true);
    setError(null);
    try {
      const created = await api<Campaign>("/campaigns", {
        method: "POST",
        body: {
          name: v.name.trim(),
          description: v.description.trim() || null,
          status: "draft",
          start_date: toIso(v.start_date),
          end_date: toIso(v.end_date),
          target_codes: v.target_codes,
          sources: v.sources
            .filter((s) => s.name.trim())
            .map((s) => ({
              name: s.name.trim(),
              type: s.type,
              platform: s.platform,
              external_id: s.external_id.trim() || null,
            })),
        },
      });
      const warning = await linkMetaForms(created, v.sources);
      if (warning) toast.warning("Campagne créée", { description: warning });
      else toast.success("Campagne créée", { description: "En brouillon : activez-la depuis sa fiche pour recevoir des prospects." });
      router.push(`/campaigns/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de la création");
      setBusy(false);
    }
  }

  return (
    <Screen className="max-w-[960px]" scroll>
      <PageHeader eyebrow="Pilotage · Campagnes" title="Nouvelle campagne" subtitle="Nom, période, programmes et sources : l’agent répondra aux personnes que la campagne amène." />
      <Loading loading={targets.loading} error={targets.error} onRetry={targets.reload} />
      {targets.data && (
        <CampaignForm
          initial={EMPTY_VALUES}
          targets={targets.data}
          withSources
          steps
          submitLabel="Créer la campagne"
          busy={busy}
          error={error}
          onSubmit={create}
          onCancel={() => guard(() => router.push("/campaigns"))}
          dirtyRef={dirty}
        />
      )}
      {dialog}
    </Screen>
  );
}
