"use client";

import { useEffect, useState } from "react";
import { Btn, ErrorText, SelectInput } from "@/components/ds/controls";
import { api } from "@/lib/api";
import type { Campaign, Page } from "@/lib/types";

/** Choix d'une campagne puis d'une de ses sources (destination des prospects reçus). */
export function CampaignSourcePicker({
  value,
  onChange,
}: {
  value: { campaign_id: number | null; source_id: number | null };
  onChange: (v: {
    campaign_id: number | null;
    source_id: number | null;
  }) => void;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api<Page<Campaign>>("/campaigns?limit=200")
      .then((p) => { if (!cancelled) { setCampaigns(p.items); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (loading || error || prefilled) return;
    setPrefilled(true);
    const params = new URLSearchParams(window.location.search);
    const candidate = campaigns.find((c) => c.id === Number(params.get("campaign")));
    const source = candidate?.sources.find((s) => s.id === Number(params.get("source")));
    // Un lien ne peut imposer une source qui n'appartient pas à la campagne.
    if (candidate && source && value.campaign_id === null && value.source_id === null)
      onChange({ campaign_id: candidate.id, source_id: source.id });
  }, [campaigns, loading, error, prefilled, onChange, value]);
  const campaign = campaigns.find((c) => c.id === value.campaign_id);
  return (
    <>
      <SelectInput label="Campagne" className="min-w-0 flex-1 basis-48"
        value={String(value.campaign_id ?? "")} disabled={loading || error}
        onChange={(v) => {
          const id = v ? Number(v) : null;
          const sources = campaigns.find((c) => c.id === id)?.sources ?? [];
          onChange({ campaign_id: id, source_id: sources.length === 1 ? sources[0].id : null });
        }}
        options={[{ value: "", label: loading ? "Chargement…" : "Aucune (à rattacher plus tard)" },
          ...campaigns.map((c) => ({ value: String(c.id), label: c.name }))]}
      />
      {campaign && (
        <SelectInput label="Source" className="min-w-0 flex-1 basis-40"
            value={String(value.source_id ?? "")}
            disabled={campaign.sources.length === 0}
            options={[{ value: "", label: campaign.sources.length ? "Choisir une source" : "Aucune source dans cette campagne" },
              ...campaign.sources.map((s) => ({ value: String(s.id), label: s.name }))]}
            onChange={(v) =>
              onChange({
                campaign_id: value.campaign_id,
                source_id: v ? Number(v) : null,
              })
            }
        />
      )}
      {error && <div><ErrorText>Campagnes indisponibles. La destination n’a pas été chargée.</ErrorText>
        <Btn size="sm" onClick={() => { setLoading(true); setAttempt((n) => n + 1); }}>Réessayer</Btn></div>}
    </>
  );
}
