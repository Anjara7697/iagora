"use client";

import { Alert, Tabs, toast } from "@heroui/react";
import { ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { EraseForm, ErasureResult } from "@/components/ErasePanel";
import ProspectResultsReturn, { backLinkClass } from "@/components/ProspectResultsReturn";
import ProspectTaskReturn from "@/components/ProspectTaskReturn";
import { Drawer } from "@/components/Drawer";
import ProspectConversation from "@/components/prospect/ProspectConversation";
import ProspectDecisions from "@/components/prospect/ProspectDecisions";
import ProspectHeader, { type ProspectAction } from "@/components/prospect/ProspectHeader";
import ProspectJourney from "@/components/prospect/ProspectJourney";
import ProspectOverview from "@/components/prospect/ProspectOverview";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, ErrorText, Field, TAB_RADIUS, TextBox, TextInput } from "@/components/ds/controls";
import { Screen } from "@/components/ds/layout";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { PROSPECT_TABS, prospectTabHref, readProspectTab, replaceUrl, type ProspectTab } from "@/lib/prospectNav";
import type { AgentRun, Conversation, ErasureReport, Prospect } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function ProspectPage() {
  return (
    <Suspense>
      <ProspectDetail />
    </Suspense>
  );
}

const CONFIRM = {
  agent: {
    title: "Lancer l’agent ?",
    description:
      "L’agent relit la conversation et décide de la suite. Selon son mode, sa réponse attendra votre validation ou partira directement.",
    confirmLabel: "Lancer l’agent",
    status: "accent",
  },
  "opt-out": {
    title: "Enregistrer la désinscription ?",
    description:
      "Les relances et les brouillons en attente seront annulés et plus aucun message ne pourra être envoyé à ce prospect.",
    confirmLabel: "Enregistrer la désinscription",
    status: "danger",
  },
} as const;

/** Fiche d'un prospect : en-tête et actions, puis quatre onglets ; l'onglet ouvert est dans l'URL (`?tab=`). */
function ProspectDetail() {
  const user = useCurrentUser();
  const { id } = useParams<{ id: string }>();
  const tab = readProspectTab(useSearchParams());
  const showTab = (next: ProspectTab) =>
    replaceUrl(prospectTabHref(id, next, new URLSearchParams(window.location.search)));
  // La fiche reste affichée pendant un rechargement : un panneau ouvert (modification d'un parcours) le reste aussi.
  const prospect = useApi<Prospect>(`/prospects/${id}`, { keepPrevious: true });
  const conversation = useApi<Conversation>(`/prospects/${id}/conversation`, { keepPrevious: true });
  const runs = useApi<AgentRun[]>(`/prospects/${id}/agent-runs`, { keepPrevious: true });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [erased, setErased] = useState<ErasureReport | null>(null);
  const [confirm, setConfirm] = useState<keyof typeof CONFIRM | null>(null);
  const [panel, setPanel] = useState<"consent" | "erase" | null>(null);
  const [attributing, setAttributing] = useState(false);
  const [consentSource, setConsentSource] = useState("");
  // Lever une désinscription exige un motif écrit : la preuve de la nouvelle demande (décision D-20).
  const [consentReason, setConsentReason] = useState("");
  const { guard, dialog } = useDiscardGuard(
    () => panel === "consent" && (consentSource.trim() !== "" || consentReason.trim() !== ""),
  );
  const closePanel = () =>
    guard(() => {
      setPanel(null);
      setConsentSource("");
      setConsentReason("");
      setActionError(null);
    });

  const p = prospect.data;
  const liftingOptOut = p?.consent_status === "opted_out";
  const reasonValid = consentReason.trim().length >= 10;
  const conv = conversation.data;
  const isAdmin = user?.role === "ADMIN";
  const canWrite = isAdmin || user?.role === "ADVISOR";

  function refreshAll(message: string) {
    toast.success(message);
    prospect.reload();
    conversation.reload();
    runs.reload();
    setRevision((v) => v + 1);
  }

  async function runAgent() {
    if (!conv) return;
    setBusy(true);
    setActionError(null);
    try {
      await api("/agent/runs", { method: "POST", body: { conversation_id: conv.id } });
      refreshAll("Décision de l’agent enregistrée.");
    } catch (err) {
      setActionError(`Lancement de l’agent impossible : ${err instanceof ApiError ? err.message : "échec"}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveConsent(kind: "opt-out" | "consent", source: string, reason?: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/prospects/${id}/${kind}`, {
        method: "POST",
        body: { source, channel: conv?.channel ?? null, ...(reason ? { reason } : {}) },
      });
      setPanel(null);
      setConsentSource("");
      setConsentReason("");
      refreshAll(kind === "opt-out" ? "Désinscription enregistrée." : "Consentement enregistré.");
    } catch (err) {
      setActionError(
        `${kind === "opt-out" ? "Désinscription" : "Consentement"} non enregistré : ${
          err instanceof ApiError ? err.message : "échec"
        }`,
      );
    } finally {
      setBusy(false);
    }
  }

  function onAction(action: ProspectAction) {
    setActionError(null);
    if (action === "opt-out") setConfirm("opt-out");
    else setPanel(action);
  }

  if (erased) return <ErasureResult report={erased} />;
  const pendingDraftId = conv?.messages.find(
    (m) => (m.metadata.draft as { status?: string } | undefined)?.status === "pending",
  )?.id;
  const runBlockedReason = !p
    ? null
    : p.consent_status === "opted_out"
      ? "Prospect désinscrit : aucun message ne peut lui être envoyé."
      : p.campaigns.length === 0
        ? "Attribuez d’abord une campagne et une source (onglet Parcours)."
        : conv && conv.status !== "open"
          ? "Conversation transférée ou clôturée : reprenez-la dans Conversations."
          : null;

  return (
    <Screen>
      <div className="flex flex-col gap-3">
        <ProspectTaskReturn />
        <Suspense fallback={<Link href="/prospects" className={backLinkClass}>← Tous les prospects</Link>}>
          <ProspectResultsReturn />
        </Suspense>
      </div>
      <Loading loading={prospect.loading && !prospect.data} error={prospect.error} onRetry={prospect.reload} />
      {p && (
        <>
          <ProspectHeader
            prospect={p}
            conversation={conv}
            pendingDraftId={pendingDraftId}
            canWrite={canWrite}
            isAdmin={isAdmin}
            busy={busy}
            runBlockedReason={runBlockedReason}
            onRun={() => setConfirm("agent")}
            onAction={onAction}
          />
          {actionError && !panel && <ErrorText>{actionError}</ErrorText>}
          {p.consent_status === "opted_out" && (
            <Alert status="danger" role="status">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Ce prospect est désinscrit. Les communications sortantes sont bloquées.</Alert.Title>
              </Alert.Content>
            </Alert>
          )}
          <Tabs selectedKey={tab} onSelectionChange={(key) => showTab(key as ProspectTab)}>
            <Tabs.ListContainer className={TAB_RADIUS.container}>
              <Tabs.List aria-label="Sections de la fiche prospect">
                {Object.entries(PROSPECT_TABS).map(([key, title]) => (
                  <Tabs.Tab key={key} id={key} className={TAB_RADIUS.tab}>
                    {title}
                    <Tabs.Indicator className={TAB_RADIUS.indicator} />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel id="overview" className="pt-4">
              <ProspectOverview
                prospect={p}
                conversation={conv}
                runs={runs.data}
                loading={runs.loading || conversation.loading}
                runsError={runs.error}
                onRetryRuns={runs.reload}
                canWrite={canWrite}
                onAttribute={() => {
                  showTab("journey");
                  setAttributing(true);
                }}
              />
            </Tabs.Panel>
            <Tabs.Panel id="conversation" className="pt-4">
              <ProspectConversation
                prospect={p}
                conversation={conv}
                loading={conversation.loading}
                error={conversation.error}
                onRetry={conversation.reload}
                readOnly={user?.role === "VIEWER"}
                revision={revision}
              />
            </Tabs.Panel>
            <Tabs.Panel id="journey" className="pt-4">
              <ProspectJourney
                prospect={p}
                canWrite={canWrite}
                revision={revision}
                attributing={attributing}
                onAttributingChange={setAttributing}
                onSaved={refreshAll}
              />
            </Tabs.Panel>
            <Tabs.Panel id="decisions" className="pt-4">
              <ProspectDecisions runs={runs.data} loading={runs.loading} error={runs.error} onRetry={runs.reload} />
            </Tabs.Panel>
          </Tabs>

          {confirm && (
            <ConfirmDialog
              isOpen
              onOpenChange={(open) => {
                if (!open) setConfirm(null);
              }}
              {...CONFIRM[confirm]}
              onConfirm={() =>
                confirm === "agent" ? void runAgent() : void saveConsent("opt-out", "demande enregistrée par un conseiller")
              }
            />
          )}
          <Drawer
            open={panel === "consent"}
            onClose={closePanel}
            title={p.consent_status === "opted_out" ? "Lever la désinscription" : "Enregistrer un consentement"}
            eyebrow="Consentement"
            icon={<ShieldCheck aria-hidden="true" />}
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (consentSource.trim() && (!liftingOptOut || reasonValid))
                  void saveConsent("consent", consentSource.trim(), consentReason.trim() || undefined);
              }}
            >
              <Field label="Source du consentement" hint="Par exemple : accord donné par téléphone le 12/10.">
                <TextInput
                  value={consentSource}
                  autoComplete="off"
                  onChange={(e) => setConsentSource(e.target.value)}
                />
              </Field>
              {liftingOptOut && (
                <Field
                  label="Motif et preuve"
                  hint="Obligatoire pour lever une désinscription (10 caractères au moins) : par exemple « email du 12/11 où il redemande les dates de rentrée »."
                >
                  <TextBox
                    rows={3}
                    maxLength={500}
                    value={consentReason}
                    onChange={(e) => setConsentReason(e.target.value)}
                  />
                </Field>
              )}
              {actionError && <ErrorText>{actionError}</ErrorText>}
              <div>
                <Btn
                  type="submit"
                  variant="primary"
                  disabled={busy || !consentSource.trim() || (liftingOptOut && !reasonValid)}
                >
                  Enregistrer le consentement
                </Btn>
              </div>
            </form>
          </Drawer>
          <Drawer
            open={panel === "erase"}
            onClose={closePanel}
            title="Effacer ce prospect"
            eyebrow="Données personnelles"
            icon={<Trash2 aria-hidden="true" />}
          >
            <EraseForm prospect={p} onErased={setErased} onCancel={closePanel} />
          </Drawer>
          {dialog}
        </>
      )}
    </Screen>
  );
}
