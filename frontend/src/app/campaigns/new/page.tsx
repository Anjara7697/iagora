"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import CampaignForm, {
  EMPTY_VALUES,
  type CampaignValues,
} from "@/components/CampaignForm";
import { useCurrentUser } from "@/components/AppShell";
import { Loading } from "@/components/ui";
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

  if (user && user.role !== "ADMIN") {
    return (
      <>
        <h1>Nouvelle campagne</h1>
        <p>La création de campagnes est réservée aux administrateurs.</p>
        <Link href="/campaigns">← Retour aux campagnes</Link>
      </>
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
      router.push(`/campaigns/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de la création");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Travail · Campagnes</span>
          <h1>Nouvelle campagne</h1>
        </div>
      </div>
      <Loading loading={targets.loading} error={targets.error} />
      {targets.data && (
        <CampaignForm
          initial={EMPTY_VALUES}
          targets={targets.data}
          withSources
          submitLabel="Créer la campagne"
          busy={busy}
          error={error}
          onSubmit={create}
          onCancel={() => router.push("/campaigns")}
        />
      )}
    </>
  );
}
