"use client";

import { Tabs } from "@heroui/react";
import { CalendarDays, Pause, Pencil, Play, Users } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import CampaignOverview from "@/components/campaign/CampaignOverview";
import CampaignProspects from "@/components/campaign/CampaignProspects";
import CampaignSettings from "@/components/campaign/CampaignSettings";
import CampaignSources from "@/components/campaign/CampaignSources";
import CampaignForm, { type CampaignValues } from "@/components/CampaignForm";
import { Btn, ErrorText, LinkButton, Tag, TextLink, type Tone } from "@/components/ds/controls";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { ErrorState, PageHeader, Screen } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Drawer } from "@/components/Drawer";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CAMPAIGN_STATUS, formatDay, label } from "@/lib/labels";
import type { Campaign, CampaignStats, Target } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const toIso = (value: string) => (value ? `${value}T00:00:00Z` : null);
const STATUS_TONE: Record<string, Tone> = { active: "success", draft: "warning", inactive: "neutral" };

const TABS = [
  { id: "overview", title: "Vue d'ensemble" },
  { id: "prospects", title: "Prospects" },
  { id: "sources", title: "Sources" },
  { id: "settings", title: "Réglages" },
];

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const user = useCurrentUser();
  const canEdit = user?.role === "ADMIN";
  const campaign = useApi<Campaign>(`/campaigns/${id}`);
  const stats = useApi<CampaignStats>(`/campaigns/${id}/stats`);
  const targets = useApi<Target[]>(canEdit ? "/targets" : null);
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const c = campaign.data;
  const reload = () => {
    campaign.reload();
    stats.reload();
  };

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/campaigns/${id}`, { method: "PATCH", body });
      setEditing(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'enregistrement");
    } finally {
      setBusy(false);
    }
  }

  const save = (v: CampaignValues) =>
    patch({
      name: v.name.trim(),
      description: v.description.trim() || null,
      status: v.status,
      start_date: toIso(v.start_date),
      end_date: toIso(v.end_date),
      target_codes: v.target_codes,
    });

  return (
    <Screen scroll>
      <TextLink href="/campaigns" className="w-fit text-sm">
        ← Campagnes
      </TextLink>
      <Loading loading={campaign.loading} error={campaign.error} onRetry={campaign.reload} />
      {c && (
        <>
          <PageHeader
            {...reveal(0)}
            eyebrow="Pilotage · Campagne"
            title={c.name}
            subtitle={
              <span className="flex flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <Tag tone={STATUS_TONE[c.status] ?? "neutral"}>{label(CAMPAIGN_STATUS, c.status)}</Tag>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {c.start_date || c.end_date ? `${formatDay(c.start_date)} → ${formatDay(c.end_date)}` : "Sans dates"}
                  </span>
                </span>
                {c.description && <span>{c.description}</span>}
              </span>
            }
            actions={
              <>
                {canEdit &&
                  (c.status === "active" ? (
                    <ConfirmDialog
                      trigger={
                        <Btn variant="danger-soft" className="rounded-lg" disabled={busy}>
                          <Pause className="size-4" aria-hidden="true" />
                          Désactiver
                        </Btn>
                      }
                      title="Désactiver la campagne ?"
                      description="Les nouveaux prospects ne seront plus rattachés à ses sources."
                      confirmLabel="Désactiver"
                      onConfirm={() => void patch({ status: "inactive" })}
                    />
                  ) : (
                    <Btn variant="secondary" className="rounded-lg" disabled={busy} onClick={() => patch({ status: "active" })}>
                      <Play className="size-4" aria-hidden="true" />
                      Activer
                    </Btn>
                  ))}
                {canEdit && (
                  <Btn
                    variant="outline"
                    className="rounded-lg"
                    disabled={!targets.data}
                    onClick={() => setEditing(true)}
                    aria-describedby={targets.error ? "campaign-targets-error" : undefined}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    Modifier la campagne
                  </Btn>
                )}
                <LinkButton variant="primary" className="rounded-lg" href={`/prospects?campaign=${c.id}`}>
                  <Users className="size-4" aria-hidden="true" />
                  Voir les prospects
                </LinkButton>
              </>
            }
          />
          {canEdit && targets.error && (
            <span id="campaign-targets-error">
              <ErrorState message={`Liste des programmes indisponible : ${targets.error.message}`} onRetry={targets.reload} />
            </span>
          )}
          {error && !editing && <ErrorText>{error}</ErrorText>}

          <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
            <Tabs.ListContainer>
              <Tabs.List aria-label="Sections de la campagne">
                {TABS.map((t) => (
                  <Tabs.Tab key={t.id} id={t.id}>
                    {t.title}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel id="overview" className="pt-4">
              {stats.error && <ErrorState message={`Statistiques indisponibles : ${stats.error.message}`} onRetry={stats.reload} />}
              {stats.data && <CampaignOverview stats={stats.data} />}
            </Tabs.Panel>
            <Tabs.Panel id="prospects" className="pt-4">
              <CampaignProspects campaign={c} />
            </Tabs.Panel>
            <Tabs.Panel id="sources" className="pt-4">
              <CampaignSources campaign={c} stats={stats.data} canEdit={canEdit} onChanged={reload} />
            </Tabs.Panel>
            <Tabs.Panel id="settings" className="pt-4">
              <CampaignSettings
                campaign={c}
                targets={targets.data}
                canEdit={canEdit}
                busy={busy}
                onPatch={(body) => void patch(body)}
                onOwnerDone={campaign.reload}
              />
            </Tabs.Panel>
          </Tabs>

          <Drawer open={editing && !!targets.data} onClose={() => setEditing(false)} title="Modifier la campagne" eyebrow="Campagne">
            {targets.data && (
              <CampaignForm
                initial={{
                  name: c.name,
                  description: c.description ?? "",
                  status: c.status,
                  start_date: day(c.start_date),
                  end_date: day(c.end_date),
                  target_codes: c.targets.map((t) => t.code),
                  sources: [],
                }}
                targets={targets.data}
                withSources={false}
                submitLabel="Enregistrer"
                busy={busy}
                error={error}
                onSubmit={save}
                onCancel={() => setEditing(false)}
              />
            )}
          </Drawer>
        </>
      )}
    </Screen>
  );
}
