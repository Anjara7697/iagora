"use client";

import { useEffect, useState } from "react";
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
  useEffect(() => {
    api<Page<Campaign>>("/campaigns?limit=200")
      .then((p) => setCampaigns(p.items))
      .catch(() => setCampaigns([]));
  }, []);
  const campaign = campaigns.find((c) => c.id === value.campaign_id);
  return (
    <>
      <label>
        Campagne
        <select
          value={value.campaign_id ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            const first = campaigns.find((c) => c.id === id)?.sources[0];
            onChange({ campaign_id: id, source_id: first?.id ?? null });
          }}
        >
          <option value="">Aucune (à rattacher plus tard)</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {campaign && (
        <label>
          Source
          <select
            value={value.source_id ?? ""}
            onChange={(e) =>
              onChange({
                campaign_id: value.campaign_id,
                source_id: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            {campaign.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
