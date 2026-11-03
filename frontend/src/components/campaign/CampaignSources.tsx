"use client";

import { toast } from "@heroui/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Box } from "@/components/ds/card";
import { Btn, ErrorText, Field, TextInput } from "@/components/ds/controls";
import { EmptyText, Panel } from "@/components/ds/layout";
import { SourceAvatar } from "@/components/ds/SourceAvatars";
import { DataTable, Table } from "@/components/ds/table";
import { ConnectorCatalogue, type Connector } from "@/components/SourceConnectors";
import { api, ApiError } from "@/lib/api";
import { PLATFORMS, SOURCE_TYPES, label } from "@/lib/labels";
import { linkMetaForms } from "@/lib/metaForms";
import type { Campaign, CampaignStats } from "@/lib/types";

type Draft = { connector: Connector; name: string; external_id: string };

/**
 * Sources d'une campagne : tableau (logo de la plateforme, effectifs) et, pour l'administrateur, ajout depuis le
 * catalogue de connecteurs. Un identifiant de formulaire Meta saisi est associé à la campagne comme à la création.
 */
export default function CampaignSources({
  campaign,
  stats,
  canEdit,
  onChanged,
}: {
  campaign: Campaign;
  stats: CampaignStats | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = new Map((stats?.by_source ?? []).map((s) => [s.source_id, s.prospects]));

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function add(d: Draft) {
    const updated = await api<Campaign>(`/campaigns/${campaign.id}/sources`, {
      method: "POST",
      body: {
        name: d.name.trim(),
        type: d.connector.type,
        platform: d.connector.platform,
        external_id: d.external_id.trim() || null,
      },
    });
    const warning = await linkMetaForms(updated, [{ connector: d.connector.id, name: d.name, external_id: d.external_id }]);
    if (warning) toast.warning("Source ajoutée", { description: warning });
    setDraft(null);
  }

  return (
    <Panel title="Sources de prospects" label="Sources">
      <div className="flex flex-col gap-5">
        <DataTable
          label="Sources de la campagne"
          minWidth={560}
          emptyState={<EmptyText>Aucune source rattachée : aucun prospect ne peut entrer dans cette campagne.</EmptyText>}
          columns={[
            { id: "source", label: "Source" },
            { id: "platform", label: "Plateforme" },
            { id: "type", label: "Type" },
            { id: "prospects", label: "Prospects", className: "text-right" },
            { id: "actions", label: <span className="sr-only">Actions</span> },
          ]}
        >
          {campaign.sources.map((s) => (
            <Table.Row key={s.id} id={s.id}>
              <Table.Cell className="font-medium text-foreground">
                <span className="flex items-center gap-2.5">
                  <SourceAvatar platform={s.platform} name={s.name} />
                  {s.name}
                </span>
              </Table.Cell>
              <Table.Cell className="text-muted">{label(PLATFORMS, s.platform)}</Table.Cell>
              <Table.Cell className="text-muted">{label(SOURCE_TYPES, s.type)}</Table.Cell>
              <Table.Cell className="text-right tabular-nums">{counts.get(s.id) ?? 0}</Table.Cell>
              <Table.Cell className="text-right">
                {canEdit && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    className="rounded-lg"
                    disabled={busy}
                    onClick={() => act(() => api(`/campaigns/${campaign.id}/sources/${s.id}`, { method: "DELETE" }))}
                  >
                    Retirer
                  </Btn>
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
        {error && <ErrorText>{error}</ErrorText>}

        {canEdit && (
          <div className="flex flex-col gap-3 border-t border-separator pt-5">
            <ConnectorCatalogue onAdd={(connector) => setDraft({ connector, name: connector.defaultName, external_id: "" })} />
            {draft && (
              <Box as="form" className="gap-3 p-4" aria-label={`Ajouter ${draft.connector.title}`} onSubmit={(e) => { e.preventDefault(); if (draft.name.trim()) void act(() => add(draft)); }}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Nom de la nouvelle source">
                    <TextInput variant="secondary" aria-label="Nom de la nouvelle source" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </Field>
                  {draft.connector.id === "meta" && (
                    <Field label="Identifiant du formulaire (facultatif)">
                      <TextInput
                        variant="secondary"
                        aria-label="Identifiant du formulaire Meta"
                        inputMode="numeric"
                        placeholder="ex. 1234567890"
                        value={draft.external_id}
                        onChange={(e) => setDraft({ ...draft, external_id: e.target.value })}
                      />
                    </Field>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn variant="primary" type="submit" className="rounded-lg" disabled={busy || !draft.name.trim()}>
                    <Plus className="size-4" aria-hidden="true" />
                    Ajouter à la campagne
                  </Btn>
                  <Btn variant="ghost" className="rounded-lg" disabled={busy} onClick={() => setDraft(null)}>
                    Annuler
                  </Btn>
                </div>
              </Box>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
