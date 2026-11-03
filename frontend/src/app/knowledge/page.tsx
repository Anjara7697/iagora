"use client";

import { Tabs } from "@heroui/react";
import { Plus, RefreshCw, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Btn, LinkButton, TAB_RADIUS, TextLink } from "@/components/ds/controls";
import { ErrorState, PageHeader, Screen } from "@/components/ds/layout";
import { Collapse } from "@/components/ds/collapse";
import { Feedback } from "@/components/ds/settings";
import DocumentList from "@/components/knowledge/DocumentList";
import DocumentPanel from "@/components/knowledge/DocumentPanel";
import SearchTester from "@/components/knowledge/SearchTester";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { KNOWLEDGE_TABS, knowledgeHref, readKnowledgeView, type KnowledgeTab, type KnowledgeView } from "@/lib/knowledgeNav";
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";
import type { KnowledgeDocument, KnowledgeStatus } from "@/lib/types";

export default function KnowledgePage() {
  return (
    <Suspense>
      <Knowledge />
    </Suspense>
  );
}

function Knowledge() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const status = useApi<KnowledgeStatus>("/knowledge/status");
  const docs = useApi<KnowledgeDocument[]>("/knowledge/documents");
  const view = readKnowledgeView(useSearchParams());
  // Relit l'adresse courante : deux changements rapprochés (frappe, filtre) ne s'écrasent pas.
  const navigate = (patch: Partial<KnowledgeView>) =>
    replaceUrl(knowledgeHref({ ...readKnowledgeView(new URLSearchParams(window.location.search)), ...patch }));
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      docs.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const needsReindex = docs.data?.some((d) => d.needs_reindex) ?? false;
  const gaps = useApi<{ counts: Record<string, number> }>("/todo?limit=1");
  const gapCount = gaps.data?.counts?.kb_gap ?? 0;
  const canAdd = isAdmin && status.data?.configured === true;
  const startCreating = () => {
    navigate({ doc: null, tab: "documents" });
    setCreating(true);
  };

  return (
    <Screen scroll>
      <PageHeader
        eyebrow="Intelligence · Base de connaissances"
        title="Base de connaissances"
        subtitle="Les sources de référence utilisées par l’agent pour répondre aux questions des prospects."
        actions={
          isAdmin && (
            <Btn variant="primary" className="rounded-lg" disabled={!canAdd} onClick={startCreating}>
              <Plus className="size-4" aria-hidden="true" />
              Ajouter un document
            </Btn>
          )
        }
      />

      <Loading loading={status.loading} error={status.error} onRetry={status.reload} />

      {gapCount > 0 && (
        <div
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-agent/25 bg-agent-soft/60 px-5 py-4"
          role="status"
        >
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-agent-soft text-agent" aria-hidden="true">
            <Sparkles className="size-4" />
          </span>
          <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
            <strong className="text-sm font-semibold text-foreground">
              {gapCount} demande{gapCount > 1 ? "s nécessitent" : " nécessite"}{" "}
              une source fiable
            </strong>
            <p className="text-[13px] text-muted">
              L’agent a transmis ces questions à un conseiller faute de source
              suffisante.
            </p>
          </div>
          <LinkButton variant="outline" size="sm" href="/todo?kind=kb_gap">
            Traiter la demande
          </LinkButton>
        </div>
      )}
      {status.data && !status.data.configured && (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" role="alert">
          La recherche et l’ajout de documents sont indisponibles : le service
          de recherche n’est pas configuré. L’agent transmet les questions
          factuelles à un conseiller.{" "}
          {isAdmin ? (
            <TextLink href="/settings">Configurer dans les paramètres</TextLink>
          ) : (
            "Contactez un administrateur pour l’activer."
          )}
        </p>
      )}
      {needsReindex && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" role="alert">
          <span className="min-w-[200px] flex-1">
            Certains documents doivent être actualisés avant de pouvoir être
            utilisés par l’agent.{" "}
            {!isAdmin && "Demandez à un administrateur de les recalculer."}
          </span>
          {isAdmin && (
            <Btn
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                act(
                  () => api("/knowledge/reindex", { method: "POST" }),
                  "Documents actualisés.",
                )
              }
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Actualiser les documents
            </Btn>
          )}
        </div>
      )}
      <Feedback notice={notice} error={error} />

      <Tabs selectedKey={view.tab} onSelectionChange={(key) => navigate({ tab: key as KnowledgeTab })}>
        <Tabs.ListContainer className={TAB_RADIUS.container}>
          <Tabs.List aria-label="Sections de la base de connaissances">
            {Object.entries(KNOWLEDGE_TABS).map(([key, title]) => (
              <Tabs.Tab key={key} id={key} className={TAB_RADIUS.tab}>
                {title}
                <Tabs.Indicator className={TAB_RADIUS.indicator} />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="documents" className="pt-4">
          {docs.error ? (
            <ErrorState message={`Impossible de charger les documents : ${docs.error.message}`} onRetry={docs.reload} />
          ) : (
            <DocumentList
              documents={docs.data ?? []}
              isLoading={docs.loading && !docs.data}
              view={view}
              selected={creating ? null : view.doc}
              onChange={navigate}
              onOpen={(slug) => {
                setCreating(false);
                navigate({ doc: slug });
              }}
              emptyAction={
                canAdd && (
                  <Btn variant="primary" className="rounded-lg" onClick={startCreating}>
                    <Plus className="size-4" aria-hidden="true" />
                    Ajouter un document
                  </Btn>
                )
              }
            />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="test" className="flex flex-col gap-4 pt-4">
          {status.data && <SearchTester status={status.data} />}
          {status.data && (
            <Collapse
              title="Réglages techniques de la recherche"
              className="card card--default gap-0 rounded-lg px-5 py-4 text-[13px]"
              triggerClassName="w-full text-sm"
            >
              <p className="mt-2 text-muted">Ces informations expliquent comment les extraits sont sélectionnés.</p>
              <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-muted">Modèle de recherche</dt>
                <dd className="font-mono break-all">{status.data.embedding_model ?? "Non configuré"}</dd>
                <dt className="text-muted">Seuil de pertinence</dt>
                <dd className="font-mono">{status.data.min_score}</dd>
                <dt className="text-muted">Extraits recherchés par défaut</dt>
                <dd className="font-mono">{status.data.top_k}</dd>
              </dl>
            </Collapse>
          )}
        </Tabs.Panel>
      </Tabs>

      <DocumentPanel
        slug={creating ? null : view.doc}
        creating={creating}
        documents={docs.data ?? []}
        canEdit={canAdd}
        canDelete={isAdmin}
        onClose={() => {
          setCreating(false);
          navigate({ doc: null });
        }}
        onOpen={(slug) => {
          setCreating(false);
          navigate({ doc: slug });
        }}
        onSaved={(slug) => {
          setCreating(false);
          navigate({ doc: slug });
          docs.reload();
        }}
        onDeleted={() => {
          navigate({ doc: null });
          docs.reload();
        }}
      />
    </Screen>
  );
}
