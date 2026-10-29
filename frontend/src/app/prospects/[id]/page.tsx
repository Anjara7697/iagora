"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@heroui/react";
import { ChevronRight, MessageSquare, Play, Sparkles } from "lucide-react";
import { Suspense, useState } from "react";
import ProspectResultsReturn, { backLinkClass } from "@/components/ProspectResultsReturn";
import ProspectTaskReturn from "@/components/ProspectTaskReturn";
import { useCurrentUser } from "@/components/AppShell";
import ConversationView from "@/components/ConversationView";
import { ErasePanel, ErasureResult } from "@/components/ErasePanel";
import MembershipActions from "@/components/MembershipActions";
import InteractionHistory from "@/components/InteractionHistory";
import RunView from "@/components/TraceView";
import { Btn, ErrorText, Field, LinkButton, NativeSelect, Notice, Tag, TextLink } from "@/components/ds/controls";
import { EmptyText, Eyebrow, Panel, Screen } from "@/components/ds/layout";
import { DemoBadge, Loading, ScoreBadge, StageBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  ACTIONS,
  CHANNELS,
  CONSENT,
  CONVERSATION_STATUS,
  HANDOFF_REASONS,
  PROFILE_FIELDS,
  STAGES,
  formatDate,
  fullName,
  label,
} from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type {
  AgentRun,
  Campaign,
  Conversation,
  ErasureReport,
  History,
  Page,
  Prospect,
} from "@/lib/types";

export default function ProspectPage() {
  const user = useCurrentUser();
  const { id } = useParams<{ id: string }>();
  const prospect = useApi<Prospect>(`/prospects/${id}`);
  const conversation = useApi<Conversation>(`/prospects/${id}/conversation`);
  const runs = useApi<AgentRun[]>(`/prospects/${id}/agent-runs`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [erased, setErased] = useState<ErasureReport | null>(null);
  const [editingMembership, setEditingMembership] = useState<number | null>(
    null,
  );
  const advisors = useApi<Page<{ id: number; username: string }>>(
    "/advisors?limit=50&offset=0",
  );

  function refreshTracking() {
    setNotice("Suivi enregistré.");
    prospect.reload();
    setRevision((v) => v + 1);
  }

  async function runAgent() {
    if (!conversation.data) return;
    setBusy(true);
    setActionError(null);
    try {
      await api("/agent/runs", {
        method: "POST",
        body: { conversation_id: conversation.data.id },
      });
      prospect.reload();
      conversation.reload();
      setRevision((v) => v + 1);
      runs.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  async function consentAction(kind: "opt-out" | "consent") {
    if (kind === "opt-out") {
      if (
        !window.confirm(
          "Enregistrer la désinscription ? Les relances et les brouillons en attente seront annulés et plus aucun message ne pourra être envoyé à ce prospect.",
        )
      )
        return;
    }
    const source =
      kind === "opt-out"
        ? "demande enregistrée par un conseiller"
        : (
            window.prompt(
              "Source du consentement (ex. accord donné par téléphone le 12/10) :",
            ) ?? ""
          ).trim();
    if (!source) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/prospects/${id}/${kind}`, {
        method: "POST",
        body: { source, channel: conversation.data?.channel ?? null },
      });
      setNotice(
        kind === "opt-out"
          ? "Désinscription enregistrée."
          : "Consentement enregistré.",
      );
      setRevision((v) => v + 1);
      prospect.reload();
      conversation.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const p = prospect.data;
  const conv = conversation.data;
  const canWrite = user?.role === "ADMIN" || user?.role === "ADVISOR";
  const canGrant = p?.consent_status !== "opted_out" || user?.role === "ADMIN";
  const current =
    p?.campaigns.find((m) => m.id === p.current_membership_id) ??
    p?.campaigns[0];
  const lastRun = runs.data?.[0];
  const recommendation =
    conv?.handoff?.recommended_action ||
    (lastRun?.action ? label(ACTIONS, lastRun.action) : null);
  // Le bloc n'apparaît que s'il a quelque chose à dire : désinscription, campagne
  // à attribuer, ou décision de l'agent (pendant le chargement, il reste affiché).
  const showRecommendation =
    !!p &&
    (p.consent_status === "opted_out" ||
      p.campaigns.length === 0 ||
      !!recommendation ||
      !!conv?.handoff?.summary ||
      !!lastRun?.reason ||
      runs.loading ||
      conversation.loading ||
      !!runs.error);
  if (erased) return <ErasureResult report={erased} />;
  const pendingDraftId = conv?.messages.find(
    (m) => (m.metadata.draft as { status?: string } | undefined)?.status === "pending",
  )?.id;
  const consentTone = p?.consent_status === "granted" ? "success" : p?.consent_status === "opted_out" ? "danger" : "neutral";
  return (
    <Screen>
      <div className="flex flex-col gap-3">
        <Suspense>
          <ProspectTaskReturn />
        </Suspense>
        <Suspense fallback={
          <Link href="/prospects" className={backLinkClass}>← Tous les prospects</Link>
        }>
          <ProspectResultsReturn />
        </Suspense>
      </div>
      <Loading
        loading={prospect.loading}
        error={prospect.error}
        onRetry={prospect.reload}
      />
      {p && (
        <>
          <header className="card card--default flex-row flex-wrap items-start gap-4 p-5">
            <Avatar size="lg" variant="soft" color="accent" aria-hidden="true">
              <Avatar.Fallback>
                {[p.first_name, p.last_name]
                  .filter(Boolean)
                  .map((name) => name![0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "?"}
              </Avatar.Fallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Eyebrow>Fiche prospect · #{p.id}</Eyebrow>
              <h1 className="text-[28px]/[34px] font-semibold tracking-[-0.02em] text-foreground">{fullName(p)}</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <DemoBadge email={p.email} />
                <Tag tone={consentTone}>{label(CONSENT, p.consent_status)}</Tag>
                {current && (
                  <>
                    <StageBadge stage={current.conversion_stage} />
                    <ScoreBadge
                      total={current.total_score}
                      level={current.interest_status}
                    />
                  </>
                )}
                {current?.campaign_name && <Tag>{current.campaign_name}</Tag>}
                {current?.source_name && <Tag>{current.source_name}</Tag>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {conv && (
                <LinkButton variant="outline" href={`/conversations?id=${encodeURIComponent(conv.id)}`}>
                  <MessageSquare className="size-4" aria-hidden="true" />
                  Ouvrir dans Conversations
                </LinkButton>
              )}
              {pendingDraftId && conv && (
                <LinkButton
                  variant="primary"
                  href={`/todo?id=${encodeURIComponent(`draft:${conv.id}:${pendingDraftId}`)}`}
                >
                  Voir dans la file
                </LinkButton>
              )}
            </div>
          </header>
          {notice && <Notice>{notice}</Notice>}
          {actionError && <ErrorText>{actionError}</ErrorText>}
          {p.consent_status === "opted_out" && (
            <div className="rounded-xl bg-danger-soft px-5 py-3.5 text-sm font-medium text-danger-soft-foreground">
              Ce prospect est désinscrit. Les communications sortantes sont
              bloquées.
            </div>
          )}
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              {showRecommendation && (
                <section
                  className="card card--default gap-0 overflow-hidden p-0 shadow-[var(--surface-shadow),inset_0_0_0_1px_color-mix(in_oklab,var(--agent)_22%,transparent)]"
                  aria-label="Prochaine action recommandée"
                >
                  <div className="flex flex-col gap-2 bg-agent-soft px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex size-6 items-center justify-center rounded-lg bg-agent text-agent-foreground" aria-hidden="true">
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
                          <p className="text-sm text-muted">
                            Aucune recommandation de l’agent enregistrée pour
                            l’instant.
                          </p>
                        )}
                        {lastRun && !conv?.handoff && (
                          <p className="text-xs text-muted">
                            Dernière décision enregistrée le{" "}
                            {formatDate(lastRun.started_at)}.
                          </p>
                        )}
                      </>
                    )}
                    <Loading
                      loading={runs.loading || conversation.loading}
                      error={runs.error}
                      onRetry={runs.reload}
                    />
                  </div>
                </section>
              )}
              <Panel label="Profil collecté" title="Profil collecté">
                {Object.keys(p.profile).length === 0 ? (
                  <EmptyText>Rien de collecté pour l&apos;instant.</EmptyText>
                ) : (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    {Object.entries(p.profile).map(([k, v]) => (
                      <div key={k} className="flex flex-col gap-0.5">
                        <dt className="text-xs text-muted">{PROFILE_FIELDS[k] ?? k}</dt>
                        <dd className="text-sm break-words text-foreground">
                          {typeof v === "object" && v !== null
                            ? JSON.stringify(v)
                            : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Panel>
              <Panel
                label="Conversation du prospect"
                title="Conversation"
                action={conv && <Tag>{label(CHANNELS, conv.channel)}</Tag>}
                bodyClassName="gap-4 px-5 py-4"
              >
                <Loading
                  loading={conversation.loading}
                  error={
                    conversation.error?.status === 404
                      ? null
                      : conversation.error
                  }
                  onRetry={conversation.reload}
                />
                {conversation.error?.status === 404 && (
                  <EmptyText>Aucune conversation.</EmptyText>
                )}
                {conv && (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <Tag tone={conv.status === "handed_off" ? "warning" : conv.status === "open" ? "accent" : "neutral"}>
                        {label(CONVERSATION_STATUS, conv.status)}
                      </Tag>
                      <span className="flex-1" />
                      <Btn
                        variant="primary"
                        size="sm"
                        disabled={
                          busy ||
                          p.campaigns.length === 0 ||
                          conv.status !== "open" ||
                          p.consent_status === "opted_out" ||
                          !canWrite
                        }
                        onClick={runAgent}
                      >
                        <Play className="size-4" aria-hidden="true" />
                        {busy ? "L'agent réfléchit…" : "Lancer l'agent"}
                      </Btn>
                    </div>
                    {user?.role === "VIEWER" && (
                      <p className="text-[13px] text-muted">
                        Votre accès observateur permet de consulter les échanges
                        et les décisions.
                      </p>
                    )}
                    {conv.handoff && (
                      <div className="flex flex-col gap-1 rounded-xl bg-warning-soft px-4 py-3 text-sm text-foreground">
                        <p>
                          <strong className="font-semibold">Fiche de transfert</strong> —{" "}
                          {label(HANDOFF_REASONS, conv.handoff.reason)}
                        </p>
                        {conv.handoff.pending_question && (
                          <p>Question : « {conv.handoff.pending_question} »</p>
                        )}
                        <p>
                          <b className="font-semibold">Action recommandée :</b>{" "}
                          {conv.handoff.recommended_action}
                        </p>
                      </div>
                    )}
                    <ConversationView
                      messages={conv.messages}
                      prospectName={fullName(p)}
                      channel={conv.channel}
                    />
                  </>
                )}
              </Panel>
              <InteractionHistory key={`${p.id}:${revision}`} id={p.id} />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
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
                <div className="flex flex-col gap-2 rounded-xl bg-surface-secondary p-4">
                  <Eyebrow>Consentement</Eyebrow>
                  <p className="text-sm text-foreground">
                    {label(CONSENT, p.consent_status)}
                    {p.consent_source ? ` · ${p.consent_source}` : ""}
                  </p>
                  {canWrite && (
                    <div className="flex flex-wrap gap-2">
                      {p.consent_status !== "opted_out" && (
                        <Btn
                          size="sm"
                          variant="danger-soft"
                          disabled={busy}
                          onClick={() => consentAction("opt-out")}
                        >
                          Enregistrer une désinscription
                        </Btn>
                      )}
                      {p.consent_status !== "granted" && canGrant && (
                        <Btn
                          size="sm"
                          disabled={busy}
                          onClick={() => consentAction("consent")}
                        >
                          {p.consent_status === "opted_out"
                            ? "Lever la désinscription (administrateur)"
                            : "Enregistrer un consentement"}
                        </Btn>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
              <Panel label="Parcours commercial" title="Parcours commercial" bodyClassName="gap-4 px-5 py-4">
                {p.campaigns.length === 0 && (
                  <p className="rounded-xl bg-warning-soft px-4 py-3 text-[13px] text-warning-soft-foreground">
                    À attribuer : choisissez une campagne et une source pour
                    démarrer le traitement automatique.
                  </p>
                )}
                {canWrite && p.campaigns.length === 0 && (
                  <CampaignAttribution
                    id={p.id}
                    onDone={() => {
                      refreshTracking();
                      conversation.reload();
                      runs.reload();
                    }}
                  />
                )}
                {p.current_membership_id && (
                  <p className="text-xs text-muted">
                    Contexte de l’agent : rattachement le plus récemment actif.
                    Les scores de chaque source restent distincts.
                  </p>
                )}
                {p.campaigns.map((m, index) => (
                  <div key={m.id} className="flex flex-col gap-2.5 rounded-xl border border-separator p-4">
                    <h3 className="text-sm font-semibold text-foreground">
                      {m.campaign_id ? (
                        <TextLink href={`/campaigns/${m.campaign_id}`}>
                          {m.campaign_name ?? `Campagne ${m.campaign_id}`}
                        </TextLink>
                      ) : (
                        `Parcours ${index + 1}`
                      )}
                    </h3>
                    {m.source_name && (
                      <p className="text-xs text-muted">Source : {m.source_name}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {m.id === p.current_membership_id && (
                        <Tag tone="agent">Contexte de l’agent</Tag>
                      )}
                      <StageBadge stage={m.conversion_stage} />
                      <ScoreBadge
                        total={m.total_score}
                        level={m.interest_status}
                      />
                    </div>
                    <p className="font-mono text-xs text-muted tabular-nums">
                      Intérêt {m.interest_score} · Adéquation {m.fit_score}
                    </p>
                    <p className="text-[13px] text-foreground">
                      Conseiller responsable :{" "}
                      <strong className="font-semibold">
                        {advisors.data?.items.find(
                          (a) => a.id === m.assigned_advisor_id,
                        )?.username ??
                          (m.assigned_advisor_id
                            ? `Conseiller #${m.assigned_advisor_id}`
                            : "Non affecté")}
                      </strong>
                    </p>
                    <details
                      className="group"
                      open={editingMembership === m.id}
                      onToggle={(e) => {
                        if (e.currentTarget.open) setEditingMembership(m.id);
                        else
                          setEditingMembership((old) =>
                            old === m.id ? null : old,
                          );
                      }}
                    >
                      <summary
                        data-membership={m.id}
                        className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 text-[13px] font-medium text-link outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden"
                      >
                        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
                        Modifier l’affectation ou l’étape
                      </summary>
                      <MembershipActions
                        key={`${m.id}:${m.assigned_advisor_id}:${m.assignment_is_override}:${m.conversion_stage}`}
                        membership={m}
                        onDone={refreshTracking}
                      />
                    </details>
                    <MembershipHistory
                      key={`${m.id}:${revision}`}
                      id={m.id}
                      index={index + 1}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted">
                  Le score sert à prioriser le suivi du prospect.
                </p>
              </Panel>
              <Panel label="Décisions de l’agent" title="Décisions de l'agent" bodyClassName="gap-0 px-5 py-2">
                <Loading
                  loading={runs.loading}
                  error={runs.error}
                  onRetry={runs.reload}
                />
                {runs.data?.length === 0 && (
                  <EmptyText>
                    L&apos;agent n&apos;a pas encore traité ce prospect.
                  </EmptyText>
                )}
                {runs.data?.map((r) => (
                  <div key={r.run_id} className="flex flex-col gap-2 border-b border-separator py-4 last:border-b-0">
                    <div className="font-mono text-xs text-muted tabular-nums">{formatDate(r.started_at)}</div>
                    <RunView run={r} />
                    {r.reply && (
                      <blockquote className="rounded-xl border-l-2 border-agent/40 bg-surface-secondary px-4 py-3 text-sm whitespace-pre-wrap text-foreground">
                        {r.reply}
                      </blockquote>
                    )}
                  </div>
                ))}
              </Panel>
            </div>
          </div>
          {user?.role === "ADMIN" && (
            <ErasePanel prospect={p} onErased={setErased} />
          )}
        </>
      )}
    </Screen>
  );
}

function MembershipHistory({ id, index }: { id: number; index: number }) {
  const history = useApi<History>(`/campaign-prospects/${id}/history`);
  return (
    <>
      {history.data && (
        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
            Historique du parcours {index}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-separator pl-4 text-[13px] text-foreground">
            {history.data.stage_events.map((e) => (
              <li key={`s${e.id}`}>
                <span className="font-mono text-xs text-muted">{formatDate(e.created_at)}</span> — étape :{" "}
                {label(STAGES, e.from_stage)} →{" "}
                <b className="font-semibold">{label(STAGES, e.to_stage)}</b>{" "}
                {e.reason ? `(${e.reason})` : ""}
              </li>
            ))}
            {history.data.score_events.map((e) => (
              <li key={`p${e.id}`}>
                <span className="font-mono text-xs text-muted">{formatDate(e.created_at)}</span> — {e.score_type}{" "}
                {e.points >= 0 ? "+" : ""}
                {e.points} → {e.new_value} ({e.reason})
              </li>
            ))}
          </ul>
        </details>
      )}
      <Loading
        loading={history.loading}
        error={history.error}
        onRetry={history.reload}
      />
    </>
  );
}

function CampaignAttribution({
  id,
  onDone,
}: {
  id: number;
  onDone: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const campaigns = useApi<Page<Campaign>>(
    `/campaigns?status=active&limit=50&offset=${offset}`,
  );
  const [campaign, setCampaign] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = campaigns.data?.items.find((c) => c.id === Number(campaign));
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Attribution commerciale"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/prospects/${id}/campaigns`, {
            method: "POST",
            body: {
              campaign_id: Number(campaign),
              source_id: Number(source),
            },
          });
          onDone();
        } catch (err) {
          setError(
            err instanceof ApiError ? err.message : "Attribution impossible",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Loading
        loading={campaigns.loading}
        error={campaigns.error}
        onRetry={campaigns.reload}
      />
      {campaigns.data && campaigns.data.total > 50 && (
        <div className="flex items-center justify-between gap-2">
          <Btn
            size="sm"
            variant="ghost"
            disabled={offset === 0 || busy}
            onClick={() => {
              setOffset(offset - 50);
              setCampaign("");
              setSource("");
            }}
          >
            Campagnes précédentes
          </Btn>
          <span className="font-mono text-xs text-muted tabular-nums">
            {offset + 1}–{Math.min(offset + 50, campaigns.data.total)} /{" "}
            {campaigns.data.total}
          </span>
          <Btn
            size="sm"
            variant="ghost"
            disabled={offset + 50 >= campaigns.data.total || busy}
            onClick={() => {
              setOffset(offset + 50);
              setCampaign("");
              setSource("");
            }}
          >
            Campagnes suivantes
          </Btn>
        </div>
      )}
      <Field label="Campagne d’attribution">
        <NativeSelect
          value={campaign}
          disabled={busy || campaigns.loading}
          onChange={(e) => {
            setCampaign(e.target.value);
            setSource("");
          }}
        >
          <option value="">Choisir une campagne active</option>
          {campaigns.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Source d’attribution">
        <NativeSelect
          value={source}
          disabled={busy || !selected}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Choisir une source</option>
          {selected?.sources?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {selected?.sources?.length === 0 && (
        <p className="text-[13px] text-muted">
          Aucune source pour cette campagne. Un administrateur doit en ajouter
          une depuis la fiche campagne.
        </p>
      )}
      {campaigns.data?.total === 0 && (
        <p className="text-[13px] text-muted">
          Aucune campagne active. Un administrateur doit en créer ou en activer
          une.
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div>
        <Btn type="submit" variant="primary" disabled={busy || !campaign || !source}>
          Attribuer et démarrer le suivi
        </Btn>
      </div>
    </form>
  );
}
