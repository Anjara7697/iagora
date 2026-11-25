"use client";

import { toast } from "@heroui/react";
import { useState } from "react";
import { AGENT_COPY, AgentDot } from "@/components/agent/AgentStatus";
import { Btn, Notice, SelectBox } from "@/components/ds/controls";
import { Panel } from "@/components/ds/layout";
import { Loading } from "@/components/ds/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { AgentMessageKind, AgentMode, CampaignAgentModes as Modes } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const KINDS: { kind: AgentMessageKind; title: string; text: string }[] = [
  { kind: "first_contact", title: "Premiers contacts", text: "Le premier message envoyé aux personnes importées ou inscrites." },
  { kind: "reply", title: "Réponses", text: "Les réponses de l’agent aux messages des prospects." },
  { kind: "follow_up", title: "Relances", text: "Les messages aux prospects restés sans réponse." },
];

const INHERIT = "";
type Choice = AgentMode | typeof INHERIT;
type Draft = Record<AgentMessageKind, Choice>;

const CHOICE_LABEL: Record<AgentMode, string> = {
  assisted: "À valider par un conseiller",
  auto: "Automatique, sans validation",
  manual: "Arrêté sur cette campagne",
};

function fromServer(m: Modes): Draft {
  return {
    first_contact: m.overrides.first_contact ?? INHERIT,
    reply: m.overrides.reply ?? INHERIT,
    follow_up: m.overrides.follow_up ?? INHERIT,
  };
}

/**
 * Autonomie de l'agent sur la campagne (D-51) : pour les premiers contacts, les réponses et les relances, suivre le
 * réglage général, faire valider, envoyer sans validation ou arrêter l'agent. L'arrêt d'urgence général prime
 * toujours ; le mode automatique n'est pas proposé là où il est refusé (production, D-16).
 */
export default function CampaignAgentModes({ campaignId, canEdit }: { campaignId: number; canEdit: boolean }) {
  const modes = useApi<Modes>(`/campaigns/${campaignId}/agent-modes`);
  return (
    <Panel title="Autonomie de l’agent" label="Autonomie de l’agent">
      <Loading loading={modes.loading} error={modes.error} onRetry={modes.reload} />
      {modes.data && (
        <ModesForm key={modes.data.updated_at ?? "default"} data={modes.data} canEdit={canEdit} onSaved={modes.reload} campaignId={campaignId} />
      )}
    </Panel>
  );
}

function ModesForm({ data, canEdit, onSaved, campaignId }: { data: Modes; canEdit: boolean; onSaved: () => void; campaignId: number }) {
  const initial = fromServer(data);
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const changed = KINDS.some(({ kind }) => draft[kind] !== initial[kind]);
  const globalLabel = AGENT_COPY[data.global_mode].short.toLowerCase();
  const options = [
    { value: INHERIT, label: `Réglage général (${globalLabel})` },
    ...(["assisted", ...(data.auto_allowed ? (["auto"] as const) : []), "manual"] as AgentMode[]).map((m) => ({ value: m, label: CHOICE_LABEL[m] })),
  ];

  async function save() {
    setBusy(true);
    try {
      const body = Object.fromEntries(KINDS.map(({ kind }) => [kind, draft[kind] || null]));
      await api(`/campaigns/${campaignId}/agent-modes`, { method: "PUT", body });
      toast.success("Autonomie de l’agent enregistrée");
      onSaved();
    } catch (err) {
      toast.danger("Enregistrement impossible", { description: err instanceof ApiError ? err.message : "Réessayez." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="type-body text-muted">
        Par défaut, la campagne suit le réglage général de l’agent. Vous pouvez le changer ici pour chaque type de message.
        {!data.auto_allowed && " Le mode automatique n’est pas disponible en production : chaque message y est validé."}
      </p>
      {data.global_mode === "manual" && (
        <Notice tone="warning">L’agent est arrêté pour toutes les campagnes (arrêt d’urgence). Ces réglages s’appliqueront à la reprise.</Notice>
      )}
      <ul className="flex flex-col divide-y divide-separator">
        {KINDS.map(({ kind, title, text }) => {
          const effective = data.effective[kind] as AgentMode;
          return (
            <li key={kind} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="type-body font-medium text-foreground">{title}</span>
                <span className="type-caption text-muted">{text}</span>
                <span className={`inline-flex items-center gap-1.5 type-caption font-medium ${AGENT_COPY[effective].tone}`}>
                  <AgentDot mode={effective} />
                  Appliqué : {AGENT_COPY[effective].short}
                </span>
              </div>
              {canEdit ? (
                <div className="w-full md:w-72">
                  <SelectBox
                    aria-label={`${title} : autonomie de l’agent`}
                    value={draft[kind]}
                    onChange={(e) => setDraft((d) => ({ ...d, [kind]: e.target.value as Choice }))}
                    disabled={busy}
                  >
                    {options.map((o) => (
                      <option key={o.value || "inherit"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </SelectBox>
                </div>
              ) : (
                <span className="type-body text-muted md:w-72">{draft[kind] ? CHOICE_LABEL[draft[kind] as AgentMode] : options[0].label}</span>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant="secondary" disabled={busy || !changed} onClick={() => void save()}>
            Enregistrer l’autonomie
          </Btn>
          {data.updated_at && <span className="type-caption text-muted">Modifié le {formatDate(data.updated_at)}.</span>}
        </div>
      )}
    </div>
  );
}
