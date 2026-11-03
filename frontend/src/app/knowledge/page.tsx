"use client";

import { FileText, Plus, RefreshCw, Search, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { DemoChip } from "@/components/ds/badges";
import { Btn, ErrorText, Field, FilterChip, LinkButton, SelectBox, Tag, TextInput, TextLink } from "@/components/ds/controls";
import { EmptyText, PageHeader, Panel, Screen } from "@/components/ds/layout";
import { DataTable, Table } from "@/components/ds/table";
import { Collapse } from "@/components/ds/collapse";
import { Feedback } from "@/components/ds/settings";
import DocumentPanel from "@/components/knowledge/DocumentPanel";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { SLUG_PATTERN } from "@/lib/knowledgeDoc";
import { TARGETS, formatDate, label } from "@/lib/labels";
import { replaceUrl } from "@/lib/url";
import { useApi } from "@/lib/useApi";
import type { KnowledgeDocument, KnowledgeStatus, SearchResult } from "@/lib/types";
import { Box } from "@/components/ds/card";

function ScoreBar({ score, threshold, retained }: { score: number; threshold: number; retained: boolean }) {
  return (
    <div className="relative h-1.5 rounded-full bg-surface-tertiary" aria-hidden="true">
      <div
        className={`h-full rounded-full ${retained ? "bg-success" : "bg-muted/50"}`}
        style={{ width: `${Math.round(score * 100)}%` }}
      />
      <span
        className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground"
        style={{ left: `${Math.round(threshold * 100)}%` }}
      />
    </div>
  );
}


function SearchTester({ status }: { status: KnowledgeStatus }) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("ebihar_students");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api<SearchResult>("/knowledge/search", {
          method: "POST",
          body: { query, target_code: target || null, limit: 6 },
        }),
      );
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "Échec de la recherche");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Tester une question" label="Tester une question" bodyClassName="gap-4 px-5 py-4">
      <p className="text-[13px]/[20px] text-muted">
        Vérifiez quelles sources l’agent peut utiliser avant de répondre à un
        prospect. Les extraits trop peu pertinents sont écartés.
      </p>
      <form className="flex flex-col gap-3" onSubmit={run}>
        <Field label="Question du prospect">
          <TextInput
            placeholder="Ex. Combien de temps dure le programme ?"
            value={query}
            disabled={busy}
            onChange={(e) => {
              setQuery(e.target.value);
              setResult(null);
            }}
          />
        </Field>
        <Field label="Programme du prospect">
          <SelectBox
            value={target}
            disabled={busy}
            onChange={(e) => {
              setTarget(e.target.value);
              setResult(null);
            }}
          >
            <option value="">Tous les programmes</option>
            {Object.entries(TARGETS).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Btn
          variant="primary"
          type="submit"
          className="w-fit"
          disabled={busy || query.trim().length < 2 || !status.configured}
        >
          <Search className="size-4" aria-hidden="true" />
          {busy ? "Recherche…" : "Tester"}
        </Btn>
      </form>
      {error && <ErrorText>{error}</ErrorText>}
      {result && result.results.length === 0 && (
        <EmptyText>
          Aucun extrait : la base est vide pour ce programme, ou les vecteurs
          sont à recalculer.
        </EmptyText>
      )}
      {result && result.results.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {result.results.map((hit, i) => (
            <li
              key={i}
              className={`flex flex-col gap-2 rounded-xl border px-4 py-3 ${hit.retained ? "border-success/30 bg-success-soft/40" : "border-separator bg-surface-secondary/60"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{hit.source}</strong>
                <Tag tone={hit.retained ? "success" : "neutral"}>
                  {hit.retained ? "Retenu" : "Écarté (sous le seuil)"}
                </Tag>
                <span className="text-xs text-muted tabular-nums">{hit.score.toFixed(3)}</span>
              </div>
              <ScoreBar score={hit.score} threshold={result.threshold} retained={hit.retained} />
              <p className="text-[13px]/[20px] text-muted">{hit.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense>
      <Knowledge />
    </Suspense>
  );
}

/** Ouvre un document dans le panneau latéral : son identifiant est dans l'adresse (`?doc=`), donc partageable. */
function docHref(slug: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (slug) params.set("doc", slug);
  else params.delete("doc");
  const search = params.toString();
  return `/knowledge${search ? `?${search}` : ""}`;
}

function Knowledge() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const status = useApi<KnowledgeStatus>("/knowledge/status");
  const docs = useApi<KnowledgeDocument[]>("/knowledge/documents");
  const requested = useSearchParams().get("doc");
  const selected = requested && SLUG_PATTERN.test(requested) ? requested : null;
  const openDoc = (slug: string | null) => replaceUrl(docHref(slug));
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
  const [programme, setProgramme] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const programmes = Array.from(
    new Set((docs.data ?? []).map((d) => d.target_code ?? "")),
  );
  const shown = (docs.data ?? []).filter(
    (d) =>
      (programme === null || (d.target_code ?? "") === programme) &&
      `${d.title} ${d.slug}`
        .toLocaleLowerCase("fr")
        .includes(query.trim().toLocaleLowerCase("fr")),
  );

  return (
    <Screen>
      <PageHeader
        eyebrow="Intelligence · Base de connaissances"
        title="Base de connaissances"
        subtitle="Les sources de référence utilisées par l’agent pour répondre aux questions des prospects."
        actions={
          isAdmin && (
            <Btn
              variant="primary"
              disabled={status.loading || !status.data?.configured}
              onClick={() => {
                openDoc(null);
                setCreating(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Ajouter un document
            </Btn>
          )
        }
      />

      <Loading
        loading={status.loading}
        error={status.error}
        onRetry={status.reload}
      />
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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Loading
            loading={docs.loading}
            error={docs.error}
            onRetry={docs.reload}
          />
          <Box as="section" className="gap-4 p-5" aria-label="Documents disponibles">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex-1 text-base font-semibold text-foreground">Documents disponibles</h2>
              {docs.data && (
                <span className="text-[13px] text-muted tabular-nums" role="status">
                  {shown.length} document{shown.length > 1 ? "s" : ""}
                  {programme !== null || query ? " affiché(s)" : ""}
                </span>
              )}
            </div>
            {docs.data && (docs.data.length > 0 || programmes.length > 1) && (
              <div className="flex flex-wrap items-end gap-3">
                {docs.data.length > 0 && (
                  <Field label="Rechercher un document" className="w-full sm:w-72">
                    <TextInput
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Titre ou identifiant…"
                    />
                  </Field>
                )}
                {programmes.length > 1 && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Programme">
                    <FilterChip pressed={programme === null} onClick={() => setProgramme(null)}>
                      Toutes
                    </FilterChip>
                    {programmes.map((code) => (
                      <FilterChip key={code} pressed={programme === code} onClick={() => setProgramme(code)}>
                        {code ? label(TARGETS, code) : "Documents communs"}
                      </FilterChip>
                    ))}
                  </div>
                )}
              </div>
            )}
            {docs.data && shown.length > 0 && (
              <p className="text-xs text-muted md:hidden">
                Faites défiler le tableau pour voir le statut et les actions.
              </p>
            )}
            {docs.data && shown.length > 0 && (
              <DataTable
                label="Liste des documents"
                minWidth={620}
                columns={[
                  { id: "doc", label: "Document", className: "min-w-[240px]" },
                  { id: "program", label: "Programme" },
                  { id: "chunks", label: "Extraits", className: "text-right" },
                  { id: "updated", label: "Mis à jour" },
                  { id: "status", label: "Statut" },
                ]}
              >
                {shown.map((d) => {
                  const open = d.slug === selected;
                  return (
                    <Table.Row key={d.slug} id={d.slug} className={open ? "bg-accent-soft/50" : undefined}>
                      <Table.Cell>
                        <span className="flex items-start gap-2.5">
                          <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <Btn
                              variant="ghost"
                              className="h-auto w-fit justify-start px-0 py-0 text-left font-medium hover:bg-transparent hover:text-accent hover:underline"
                              onClick={() => {
                                setCreating(false);
                                openDoc(d.slug);
                              }}
                            >
                              {d.title}
                            </Btn>
                            <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                              {d.slug}
                              {d.is_demo && <DemoChip />}
                            </span>
                          </span>
                        </span>
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-muted">
                        {d.target_code ? label(TARGETS, d.target_code) : "Tous"}
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{d.chunks}</Table.Cell>
                      <Table.Cell className="text-xs whitespace-nowrap text-muted tabular-nums">{formatDate(d.updated_at)}</Table.Cell>
                      <Table.Cell>
                        <Tag tone={d.needs_reindex ? "warning" : "success"}>
                          {d.needs_reindex ? "À recalculer" : "À jour"}
                        </Tag>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </DataTable>
            )}
            {docs.data && shown.length === 0 && (
              <p className="rounded-xl border border-separator px-4 py-8 text-center text-sm text-muted">
                {docs.data.length === 0 ? (
                  <>
                    Aucun document.{" "}
                    {isAdmin
                      ? "Ajoutez le premier avec le bouton ci-dessus."
                      : "Un administrateur peut ajouter les documents de référence."}
                  </>
                ) : (
                  <>
                    Aucun document ne correspond à ces critères.{" "}
                    <Btn
                      variant="ghost"
                      size="sm"
                      className="text-link"
                      onClick={() => {
                        setQuery("");
                        setProgramme(null);
                      }}
                    >
                      Réinitialiser les filtres
                    </Btn>
                  </>
                )}
              </p>
            )}
            {docs.data?.some((d) => d.is_demo) && (
              <p className="text-xs/[18px] text-muted">
                Les documents « Fictif » sont des données de démonstration : ils ne
                sont jamais utilisés en production.
              </p>
            )}
          </Box>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-24">
          {status.data && <SearchTester status={status.data} />}
          {status.data && (
            <Collapse
  title="Réglages techniques de la recherche"
  className="card card--default gap-0 px-5 py-4 text-[13px]"
  triggerClassName="w-full text-sm"
>
              <p className="mt-2 text-muted">
                Ces informations expliquent comment les extraits sont sélectionnés.
              </p>
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
        </aside>
      </div>

      <DocumentPanel
        slug={creating ? null : selected}
        creating={creating}
        documents={docs.data ?? []}
        canEdit={isAdmin && status.data?.configured === true}
        canDelete={isAdmin}
        onClose={() => {
          setCreating(false);
          openDoc(null);
        }}
        onOpen={(slug) => {
          setCreating(false);
          openDoc(slug);
        }}
        onSaved={(slug) => {
          setCreating(false);
          openDoc(slug);
          docs.reload();
        }}
        onDeleted={() => {
          openDoc(null);
          docs.reload();
        }}
      />
    </Screen>
  );
}
