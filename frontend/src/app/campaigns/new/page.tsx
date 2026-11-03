"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import CampaignForm, {
  EMPTY_VALUES,
  type CampaignValues,
} from "@/components/CampaignForm";
import { useCurrentUser } from "@/components/AppShell";
import { TextLink } from "@/components/ds/controls";
import { PageHeader, Screen } from "@/components/ds/layout";
import { Loading } from "@/components/ui";
import { toast } from "@heroui/react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Campaign, MetaFormMapping, MetaSettings, Target } from "@/lib/types";

const toIso = (day: string) => (day ? `${day}T00:00:00Z` : null);

/**
 * Associe à la campagne créée les formulaires Meta saisis à l'étape des sources (identifiant du formulaire → campagne,
 * source, programme s'il est unique). Renvoie un message si l'association n'a pas pu se faire : la campagne existe déjà.
 */
async function linkMetaForms(created: Campaign, drafts: CampaignValues["sources"]): Promise<string | null> {
  const forms = drafts.filter((s) => s.connector === "meta" && s.external_id.trim());
  if (forms.length === 0) return null;
  try {
    const cfg = await api<MetaSettings>("/integrations/meta");
    if (!cfg.configured) return "Meta n’est pas encore connectée : associez le formulaire dans Intégrations → Meta Lead Ads.";
    const added = forms.flatMap((draft): MetaFormMapping[] => {
      const source = created.sources.find((x) => x.platform === "meta" && x.external_id === draft.external_id.trim());
      return source
        ? [
            {
              form_id: draft.external_id.trim(),
              form_name: draft.name.trim(),
              campaign_id: created.id,
              source_id: source.id,
              target_code: created.targets.length === 1 ? created.targets[0].code : null,
              enabled: true,
            },
          ]
        : [];
    });
    await api("/integrations/meta", {
      method: "PUT",
      body: {
        app_id: cfg.app_id,
        api_version: cfg.api_version,
        enabled: cfg.enabled,
        mappings: [...cfg.mappings.filter((m) => !added.some((a) => a.form_id === m.form_id)), ...added],
        app_secret: null,
        page_access_token: null,
        verify_token: null,
      },
    });
    return null;
  } catch {
    return "Le formulaire Meta n’a pas pu être associé : faites-le dans Intégrations → Meta Lead Ads.";
  }
}

export default function NewCampaignPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const targets = useApi<Target[]>("/targets");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          status: v.status,
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
          onCancel={() => router.push("/campaigns")}
        />
      )}
    </Screen>
  );
}
