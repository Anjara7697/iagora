"use client";

import { buttonVariants, toast, Tooltip } from "@heroui/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Box } from "@/components/ds/card";
import { Btn, ErrorText, Field, TextInput } from "@/components/ds/controls";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { EmptyText } from "@/components/ds/layout";
import { SourceAvatar } from "@/components/ds/SourceAvatars";
import { DataTable, Table } from "@/components/ds/table";
import { ConnectorCatalogue, type Connector } from "@/components/SourceConnectors";
import { api, ApiError } from "@/lib/api";
import { PLATFORMS, SOURCE_TYPES, label } from "@/lib/labels";
import { linkMetaForms } from "@/lib/metaForms";
import type { Campaign, CampaignStats } from "@/lib/types";
import { SourceReception } from "./SourceReception";

const plural = (n: number) => (n > 1 ? `${n} prospects proviennent` : "1 prospect provient");

type Draft = { connector: Connector; name: string; external_id: string };

/**
 * Sources d'une campagne : tableau (logo de la plateforme, effectifs) et, pour l'administrateur, ajout depuis le
 * catalogue de connecteurs. Un identifiant de formulaire Meta saisi est associé à la campagne comme à la création.
 * Retirer : impossible (bouton désactivé, raison en infobulle) quand des prospects proviennent de la source, règle
 * du serveur ; sinon après confirmation.
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
    else toast.success("Source ajoutée", { description: `« ${d.name.trim()} » est rattachée à la campagne.` });
    setDraft(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <SourceReception campaign={campaign} canEdit={canEdit} />
      <section aria-label="Sources" className="flex flex-col gap-3">
        <DataTable
          label="Sources de la campagne"
          minWidth={560}
          emptyState={<EmptyText>Ajoutez une source, puis branchez un formulaire ou importez des contacts.</EmptyText>}
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
                {canEdit &&
                  ((counts.get(s.id) ?? 0) > 0 ? (
                    <Tooltip delay={200}>
                      {/* Bouton désactivé mais focalisable (aria-disabled) : la raison reste lisible au survol et au clavier. */}
                      <Tooltip.Trigger tabIndex={0} aria-disabled="true" className={buttonVariants({ variant: "ghost", size: "sm", className: "rounded-lg cursor-not-allowed pointer-events-auto!" })}>
                        Retirer
                      </Tooltip.Trigger>
                      <Tooltip.Content showArrow className="max-w-64 break-normal">
                        <Tooltip.Arrow />
                        {plural(counts.get(s.id) ?? 0)} de cette source : elle ne peut pas être retirée.
                      </Tooltip.Content>
                    </Tooltip>
                  ) : (
                    <ConfirmDialog
                      trigger={
                        <Btn variant="ghost" size="sm" disabled={busy}>
                          Retirer
                        </Btn>
                      }
                      title={`Retirer « ${s.name} » ?`}
                      description="La source ne sera plus rattachée à cette campagne. Vous pourrez l’ajouter à nouveau depuis le catalogue."
                      confirmLabel="Retirer"
                      onConfirm={() =>
                        void act(async () => {
                          await api(`/campaigns/${campaign.id}/sources/${s.id}`, { method: "DELETE" });
                          toast.success("Source retirée", { description: `« ${s.name} » n’est plus rattachée à la campagne.` });
                        })
                      }
                    />
                  ))}
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
        {error && <ErrorText>{error}</ErrorText>}
      </section>

      {canEdit && (
        <section aria-labelledby="add-source-title" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="add-source-title" className="text-base font-semibold text-foreground">
              Ajouter une source
            </h2>
            <p className="text-sm text-muted">Choisissez d’où viendront les prospects de cette campagne.</p>
          </div>
          <div className="flex flex-col gap-3">
            <ConnectorCatalogue title={null} onAdd={(connector) => setDraft({ connector, name: connector.defaultName, external_id: "" })} />
            {draft && (
              <Box as="form" className="gap-3 rounded-lg p-4" aria-label={`Ajouter ${draft.connector.title}`} onSubmit={(e) => { e.preventDefault(); if (draft.name.trim()) void act(() => add(draft)); }}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Nom de la nouvelle source">
                    <TextInput aria-label="Nom de la nouvelle source" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </Field>
                  {draft.connector.id === "meta" && (
                    <Field label="Identifiant du formulaire (facultatif)">
                      <TextInput
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
                  <Btn variant="primary" type="submit" disabled={busy || !draft.name.trim()}>
                    <Plus className="size-4" aria-hidden="true" />
                    Ajouter à la campagne
                  </Btn>
                  <Btn variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                    Annuler
                  </Btn>
                </div>
              </Box>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
