"use client";

import { Sparkles } from "lucide-react";
import { Btn } from "@/components/ds/controls";
import { Box } from "@/components/ds/card";
import { EmptyText, Eyebrow, Panel } from "@/components/ds/layout";
import { Loading } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { ACTIONS, CHANNELS, CONSENT, PROFILE_FIELDS, formatDate, label } from "@/lib/labels";
import type { AgentRun, Conversation, Prospect } from "@/lib/types";

/** Onglet « Vue d'ensemble » : prochaine action recommandée, profil collecté, identité et consentement. */
export default function ProspectOverview({
  prospect: p,
  conversation: conv,
  runs,
  loading,
  runsError,
  onRetryRuns,
  canWrite,
  onAttribute,
}: {
  prospect: Prospect;
  conversation: Conversation | null;
  runs: AgentRun[] | null;
  loading: boolean;
  runsError: ApiError | null;
  onRetryRuns: () => void;
  canWrite: boolean;
  onAttribute: () => void;
}) {
  const lastRun = runs?.[0];
  const recommendation = conv?.handoff?.recommended_action || (lastRun?.action ? label(ACTIONS, lastRun.action) : null);
  // Le bloc n'apparaît que s'il a quelque chose à dire : désinscription, campagne à attribuer, ou décision de
  // l'agent (pendant le chargement, il reste affiché).
  const showRecommendation =
    p.consent_status === "opted_out" ||
    p.campaigns.length === 0 ||
    !!recommendation ||
    !!conv?.handoff?.summary ||
    !!lastRun?.reason ||
    loading ||
    !!runsError;

  return (
    <div className="flex flex-col gap-6">
      {showRecommendation && (
        <Box
          as="section"
          className="gap-0 overflow-hidden p-0 shadow-[var(--surface-shadow),inset_0_0_0_1px_color-mix(in_oklab,var(--agent)_22%,transparent)]"
          aria-label="Prochaine action recommandée"
        >
          <div className="flex flex-col gap-2 bg-agent-soft px-5 py-4">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex size-6 items-center justify-center rounded-lg bg-agent text-agent-foreground"
                aria-hidden="true"
              >
                <Sparkles className="size-3.5" />
              </span>
              <span className="text-xs font-medium text-agent-soft-foreground">Prochaine action recommandée</span>
            </div>
            {p.consent_status === "opted_out" ? (
              <>
                <h2 className="text-base font-semibold text-foreground">Respecter la désinscription</h2>
                <p className="text-sm text-foreground/85">Aucun message ne peut être envoyé à ce prospect.</p>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-foreground">
                  {recommendation ??
                    (p.campaigns.length === 0
                      ? "Attribuer une campagne et une source"
                      : "Consulter le parcours du prospect")}
                </h2>
                {conv?.handoff?.summary ? (
                  <p className="text-sm text-foreground/85">{conv.handoff.summary}</p>
                ) : lastRun?.reason ? (
                  <p className="text-sm text-foreground/85">{lastRun.reason}</p>
                ) : (
                  <p className="text-sm text-muted">Aucune recommandation de l’agent enregistrée pour l’instant.</p>
                )}
                {lastRun && !conv?.handoff && (
                  <p className="text-xs text-muted">Dernière décision enregistrée le {formatDate(lastRun.started_at)}.</p>
                )}
                {p.campaigns.length === 0 && canWrite && (
                  <div>
                    <Btn size="sm" variant="primary" onClick={onAttribute}>
                      Attribuer une campagne
                    </Btn>
                  </div>
                )}
              </>
            )}
            <Loading loading={loading} error={runsError} onRetry={onRetryRuns} />
          </div>
        </Box>
      )}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Panel label="Profil collecté" title="Profil collecté">
          {Object.keys(p.profile).length === 0 ? (
            <EmptyText>Rien de collecté pour l&apos;instant.</EmptyText>
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {Object.entries(p.profile).map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted">{PROFILE_FIELDS[k] ?? k}</dt>
                  <dd className="text-sm break-words text-foreground">
                    {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
        <Panel label="Identité et consentement" title="Identité et origine" bodyClassName="gap-4 px-5 py-4">
          <dl className="grid grid-cols-1 gap-3">
            {[
              ["Email", p.email ?? "Non renseigné"],
              ["Téléphone", p.phone ?? "Non renseigné"],
              ["Créé le", formatDate(p.created_at)],
              ["Canal de l’échange", conv ? label(CHANNELS, conv.channel) : "Non renseigné"],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3">
                <dt className="text-[13px] text-muted">{k}</dt>
                <dd className="text-sm break-words text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-1 rounded-lg bg-surface-secondary p-4">
            <Eyebrow>Consentement</Eyebrow>
            <p className="text-sm text-foreground">
              {label(CONSENT, p.consent_status)}
              {p.consent_source ? ` · ${p.consent_source}` : ""}
            </p>
            {canWrite && (
              <p className="text-xs text-muted">Pour le modifier : menu « Autres actions » en haut de la fiche.</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
