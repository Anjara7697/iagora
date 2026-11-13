"use client";

import { Tabs, toast } from "@heroui/react";
import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/lib/session";
import { Btn, TAB_RADIUS } from "@/components/ds/controls";
import { ErrorState, PageHeader, Screen } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Collapse } from "@/components/ds/collapse";
import DocumentList from "@/components/knowledge/DocumentList";
import DocumentPanel from "@/components/knowledge/DocumentPanel";
import KnowledgeAlerts from "@/components/knowledge/KnowledgeAlerts";
import SearchTester from "@/components/knowledge/SearchTester";
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
  const [reindexing, setReindexing] = useState(false);

  const toReindex = docs.data?.filter((d) => d.needs_reindex).length ?? 0;
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
        {...reveal(0)}
        eyebrow="Intelligence · Base de connaissances"
        title="Base de connaissances"
        subtitle="Les sources de référence utilisées par l’agent pour répondre aux questions des prospects."
        actions={
          isAdmin && (
            <Btn variant="primary" disabled={!canAdd} onClick={startCreating}>
              <Plus className="size-4" aria-hidden="true" />
              Ajouter un document
            </Btn>
          )
        }
      />

      {status.error && (
        <ErrorState message={`État du service de recherche indisponible : ${status.error.message}`} onRetry={status.reload} />
      )}
      <KnowledgeAlerts
        isAdmin={isAdmin}
        configured={status.data ? status.data.configured : null}
        toReindex={toReindex}
        reindexing={reindexing}
        showingReindex={view.tab === "documents" && view.status === "reindex"}
        gapCount={gapCount}
        onShowReindex={() => navigate({ tab: "documents", q: "", programme: "", status: "reindex" })}
        onReindex={async () => {
          setReindexing(true);
          try {
            const done = await api<{ documents: number }>("/knowledge/reindex", { method: "POST" });
            toast.success("Documents recalculés", {
              description: `${done.documents} document${done.documents > 1 ? "s" : ""} à nouveau utilisable${done.documents > 1 ? "s" : ""} par l’agent.`,
            });
            if (view.status) navigate({ status: "" });
            docs.reload();
          } catch (err) {
            toast.danger("Recalcul impossible", { description: err instanceof ApiError ? err.message : "Réessayez plus tard." });
          } finally {
            setReindexing(false);
          }
        }}
      />

      <Tabs {...reveal(4)} selectedKey={view.tab} onSelectionChange={(key) => navigate({ tab: key as KnowledgeTab })}>
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
                  <Btn variant="primary" onClick={startCreating}>
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
