"use client";

import { Button, toast } from "@heroui/react";
import { Bot, CircleCheck, CircleSlash, OctagonX, Play } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { AGENT_COPY, AgentDot, RESUME, STOP } from "@/components/AgentStatus";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { LinkButton, Tag } from "@/components/ds/controls";
import { EmptyText, ErrorState, PageHeader, Panel, Screen, cx } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { canAccessSettings } from "@/lib/access";
import { formatDate } from "@/lib/labels";
import type {
  AgentMode,
  CalendarSettings,
  DashboardSummary,
  EmailStatus,
  MetaSettings,
  RuntimeSettings,
  Tone,
  ZoomSettings,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

type ModeRead = { mode: AgentMode; updated_by: number | null; updated_at: string | null };

const MODES: { mode: AgentMode; title: string; text: string }[] = [
  { mode: "assisted", title: "Assisté", text: "L’agent prépare des brouillons ; rien n’est envoyé sans la validation d’un conseiller." },
  { mode: "manual", title: "Arrêté (manuel)", text: "Réponses, relances et envois de l’agent suspendus ; les conseillers répondent eux-mêmes." },
  {
    mode: "auto",
    title: "Automatique",
    text: "Réponses enregistrées sans validation. Réservé à l’administrateur et non activable depuis la console.",
  },
];

/** Écran Agent (Intelligence) : état et arrêt d'urgence, modes, ce que fait l'agent, activité, intégrations. */
export default function AgentPage() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const readOnly = !user || user.role === "VIEWER";
  const mode = useApi<ModeRead>("/agent/mode");
  const activity = useApi<DashboardSummary["activity"]>("/dashboard/activity?days=7");
  const settings = useApi<RuntimeSettings>(isAdmin ? "/settings" : null);
  const email = useApi<EmailStatus>(isAdmin ? "/integrations/email" : null);
  const calendar = useApi<CalendarSettings>(isAdmin ? "/integrations/calendar" : null);
  const zoom = useApi<ZoomSettings>(isAdmin ? "/integrations/zoom" : null);
  const meta = useApi<MetaSettings>(isAdmin ? "/integrations/meta" : null);
  const [confirm, setConfirm] = useState<AgentMode | null>(null);
  const [busy, setBusy] = useState(false);
  const current = mode.data?.mode;

  async function change(next: AgentMode) {
    setBusy(true);
    try {
      await api("/agent/mode", { method: "PUT", body: { mode: next } });
      toast.success(next === "manual" ? "Agent arrêté" : "Agent repris en mode assisté");
      mode.reload();
    } catch (err) {
      toast.danger("Changement de mode impossible", { description: err instanceof ApiError ? err.message : "Réessayez." });
    } finally {
      setBusy(false);
    }
  }

  const integrations: { key: string; name: string; tone: Tone; text: string }[] = [];
  if (email.data)
    integrations.push({
      key: "email",
      name: "Boîte email",
      tone: !email.data.configured ? "off" : email.data.last_error ? "err" : email.data.enabled ? "ok" : "warn",
      text: !email.data.configured
        ? "Non configurée"
        : email.data.last_error
          ? `Erreur : ${email.data.last_error}`
          : `${email.data.enabled ? "Lecture active" : "Lecture désactivée"} · ${email.data.send_enabled ? "envoi actif" : "envoi désactivé"}`,
    });
  if (calendar.data)
    integrations.push({
      key: "calendar",
      name: "Agenda",
      tone: calendar.data.provider === "google" ? "ok" : calendar.data.provider === "demo" ? "warn" : "off",
      text:
        calendar.data.provider === "google"
          ? `Google · ${calendar.data.connections.length} conseiller(s) connecté(s)`
          : calendar.data.provider === "demo"
            ? "Agenda de démonstration"
            : "Non configuré : l’agent transfère les demandes de rendez-vous",
    });
  if (zoom.data)
    integrations.push({
      key: "zoom",
      name: "Zoom",
      tone: zoom.data.mode === "none" ? "off" : "ok",
      text: zoom.data.mode === "none" ? "Non configuré" : zoom.data.mode === "account" ? "Compte de l’école" : "Comptes des conseillers",
    });
  if (meta.data)
    integrations.push({
      key: "meta",
      name: "Meta Lead Ads",
      tone: !meta.data.configured ? "off" : meta.data.enabled ? "ok" : "warn",
      text: !meta.data.configured ? "Non configuré" : meta.data.enabled ? "Réception active" : "Configuré, réception désactivée",
    });
  const TAG: Record<Tone, "success" | "warning" | "danger" | "neutral"> = { ok: "success", warn: "warning", err: "danger", off: "neutral" };
  const STATE: Record<Tone, string> = { ok: "En service", warn: "À surveiller", err: "Bloqué", off: "Inactif" };

  return (
    <Screen scroll>
      <PageHeader
        {...reveal(0)}
        title="Agent"
        subtitle="État de l’agent commercial, ce qu’il fait et son activité. Les réglages restent dans Paramètres."
        actions={
          user &&
          canAccessSettings(user.role) && (
            <LinkButton variant="outline" href="/settings?section=agent">
              Réglages de l’agent
            </LinkButton>
          )
        }
      />
      {mode.error && <ErrorState message={`État de l’agent indisponible : ${mode.error.message}`} onRetry={mode.reload} />}
      <div className={cx("grid grid-cols-1 items-start gap-6 lg:grid-cols-2", reveal(1).className)} style={reveal(1).style}>
        <Panel label="État de l’agent" title="État de l’agent" bodyClassName="gap-4 px-5 py-4">
          <Loading loading={mode.loading} error={null} />
          {current && (
            <>
              <div className="flex items-start gap-3">
                <span className="mt-1.5">
                  <AgentDot mode={current} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className={cx("text-base font-semibold", AGENT_COPY[current].tone)}>{AGENT_COPY[current].short}</p>
                  <p className="text-sm text-foreground">{AGENT_COPY[current].text}</p>
                  {mode.data?.updated_at && (
                    <p className="text-xs text-muted">Mode changé le {formatDate(mode.data.updated_at)}.</p>
                  )}
                </div>
              </div>
              {!readOnly &&
                (current !== "manual" ? (
                  <Button variant="danger-soft" isDisabled={busy} onPress={() => setConfirm("manual")}>
                    <OctagonX className="size-4" aria-hidden="true" />
                    Arrêt d’urgence
                  </Button>
                ) : (
                  <Button variant="tertiary" isDisabled={busy} onPress={() => setConfirm("assisted")}>
                    <Play className="size-4" aria-hidden="true" />
                    Reprendre en mode assisté
                  </Button>
                ))}
              {readOnly && <p className="text-[13px] text-muted">Votre accès observateur permet de consulter l’état.</p>}
            </>
          )}
        </Panel>
        <Panel label="Modes de fonctionnement" title="Modes de fonctionnement" bodyClassName="gap-0 px-5 py-2">
          <ul className="flex flex-col divide-y divide-separator">
            {MODES.map((m) => (
              <li key={m.mode} className="flex items-start gap-3 py-3">
                {m.mode === current ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : m.mode === "auto" ? (
                  <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                ) : (
                  <Bot className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {m.title}
                    {m.mode === current && <Tag tone="success">Actif</Tag>}
                  </span>
                  <span className="text-[13px] text-muted">{m.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className={cx("grid grid-cols-1 items-start gap-6 lg:grid-cols-2", reveal(2).className)} style={reveal(2).style}>
        <Panel label="Ce que fait l’agent" title="Ce que fait l’agent" bodyClassName="gap-3 px-5 py-4">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-foreground">
            <li>Lit chaque message entrant, qualifie le prospect et met à jour son score et son étape.</li>
            <li>Répond uniquement à partir de la base de connaissances validée ; sans extrait, il transfère au conseiller.</li>
            <li>N’invente jamais de prix, de date, de condition ni de disponibilité : une réponse non vérifiable est bloquée.</li>
            <li>Propose des créneaux réellement libres dans l’agenda et réserve le rendez-vous choisi.</li>
            <li>Transfère au conseiller les situations sensibles, les demandes d’humain et les cas incertains.</li>
            <li>Respecte immédiatement une demande de désinscription.</li>
          </ul>
          {settings.data && (
            <dl className="grid grid-cols-1 gap-2 rounded-lg bg-surface-secondary p-4 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-muted">Réponse automatique aux nouveaux messages</dt>
                <dd className="text-foreground">{settings.data.agent_auto_reply ? "Activée" : "Désactivée"}</dd>
              </div>
              <div>
                <dt className="text-muted">Modèle de langage</dt>
                <dd className="text-foreground">{settings.data.llm_model}</dd>
              </div>
              <div>
                <dt className="text-muted">Relances</dt>
                <dd className="text-foreground">
                  {settings.data.follow_up_max_per_silence} au plus par silence, de {settings.data.follow_up_window_start_hour} h à{" "}
                  {settings.data.follow_up_window_end_hour} h{settings.data.follow_up_weekdays_only ? ", jours ouvrés" : ""}
                </dd>
              </div>
            </dl>
          )}
        </Panel>
        <Panel label="Activité sur 7 jours" title="Activité sur 7 jours">
          <Loading loading={activity.loading} error={activity.error} onRetry={activity.reload} />
          {activity.data && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              {(
                [
                  [activity.data.prospects_analysed, "prospects analysés"],
                  [activity.data.drafts_generated, "brouillons générés"],
                  [activity.data.sent_after_validation, "messages envoyés après validation"],
                  [activity.data.sent_without_validation, "messages envoyés sans validation"],
                  [activity.data.escalations, "transferts au conseiller"],
                  [activity.data.errors, "erreurs techniques"],
                ] as const
              ).map(([value, text]) => (
                <div key={text} className="flex flex-col-reverse gap-1">
                  <dt className="text-[13px]/[18px] text-muted">{text}</dt>
                  <dd className="text-2xl text-foreground tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>

      {isAdmin && (
        <Panel
          label="État des intégrations"
          title="État des intégrations"
          action={
            <LinkButton size="sm" variant="secondary" href="/integrations">
              Ouvrir les intégrations
            </LinkButton>
          }
          bodyClassName="gap-0 px-5 py-2"
          className={reveal(3).className}
        >
          <Loading loading={email.loading || calendar.loading || zoom.loading || meta.loading} error={null} />
          {[email, calendar, zoom, meta].some((r) => r.error) && (
            <p className="py-2 text-[13px] text-muted">Certaines intégrations n’ont pas pu être lues : voir la page Intégrations.</p>
          )}
          {integrations.length === 0 && !email.loading && <EmptyText>Aucune intégration lue.</EmptyText>}
          <ul className="flex flex-col divide-y divide-separator">
            {integrations.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-3 py-3">
                <span className="w-36 text-sm font-medium text-foreground">{i.name}</span>
                <Tag tone={TAG[i.tone]}>{STATE[i.tone]}</Tag>
                <span className="min-w-0 flex-1 text-[13px] break-words text-muted">{i.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <ConfirmDialog
        isOpen={confirm !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirm(null);
        }}
        status={confirm === "manual" ? "danger" : "accent"}
        {...(confirm === "manual" ? STOP : RESUME)}
        onConfirm={() => {
          if (confirm) void change(confirm);
        }}
      />
    </Screen>
  );
}
