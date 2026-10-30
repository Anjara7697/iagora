"use client";

import { FileText, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { DemoChip } from "@/components/ds/badges";
import { Btn, ErrorText, Field, FilterChip, LinkButton, NativeSelect, Tag, TextBox, TextInput, TextLink } from "@/components/ds/controls";
import { EmptyText, PageHeader, Panel, Screen } from "@/components/ds/layout";
import { ActionsBar, Feedback, SettingsCard } from "@/components/ds/settings";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { TARGETS, formatDate, label } from "@/lib/labels";
import { useApi } from "@/lib/useApi";
import type {
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  KnowledgeStatus,
  SearchResult,
} from "@/lib/types";

const TEMPLATE = `---
title: Titre du document
target: ebihar_students
---
## Première section
Un fait par phrase claire, par exemple : le programme dure 18 mois.

## Deuxième section
Conditions d'admission, rythme, financement…
`;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.md$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

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

const TH = "px-4 py-2.5 font-medium";
const TD = "px-4 py-3";

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
          <NativeSelect
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
          </NativeSelect>
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
                <span className="font-mono text-xs text-muted tabular-nums">{hit.score.toFixed(3)}</span>
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

function Editor({
  initial,
  onSaved,
  onCancel,
}: {
  initial: { slug: string; content: string; locked: boolean };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState(initial.slug);
  const [content, setContent] = useState(initial.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/knowledge/documents/${slug}`, {
        method: "PUT",
        body: { content },
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Échec de l'enregistrement",
      );
    } finally {
      setBusy(false);
    }
  }

  async function load(file: File | undefined) {
    if (!file) return;
    setContent(await file.text());
    if (!slug) setSlug(slugify(file.name));
  }

  return (
    <SettingsCard
      region="Éditeur de document"
      label={initial.locked ? "Modification" : "Nouveau document"}
      title={initial.locked ? `Modifier « ${initial.slug} »` : "Ajouter un document"}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Identifiant (lettres minuscules, chiffres, tirets)">
          <TextInput
            aria-label="Identifiant du document"
            value={slug}
            disabled={initial.locked}
            onChange={(e) => setSlug(slugify(e.target.value))}
            className="font-mono"
          />
        </Field>
        <Field label="Charger un fichier .md">
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            onChange={(e) => load(e.target.files?.[0])}
            className="h-9 w-full cursor-pointer rounded-[var(--field-radius)] border border-dashed border-border bg-surface-secondary px-2 py-1.5 text-[13px] text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-default file:px-3 file:py-0.5 file:text-[13px] file:font-medium file:text-foreground"
          />
        </Field>
      </div>
      <TextBox
        aria-label="Contenu du document"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[320px] font-mono text-[13px]/[20px]"
      />
      <p className="text-xs/[18px] text-muted">
        En-tête obligatoire : <code className="rounded bg-surface-tertiary px-1 font-mono">title:</code>, et{" "}
        <code className="rounded bg-surface-tertiary px-1 font-mono">target:</code> pour
        limiter le document à un programme (
        <code className="font-mono">{Object.keys(TARGETS).join(" | ")}</code>, ou omis pour tous). Une
        section = un titre <code className="rounded bg-surface-tertiary px-1 font-mono">##</code>.
      </p>
      {error && <ErrorText>{error}</ErrorText>}
      <ActionsBar>
        <Btn
          variant="primary"
          disabled={busy || !slug || content.trim().length < 10}
          onClick={save}
        >
          {busy ? "Enregistrement…" : "Enregistrer"}
        </Btn>
        <Btn disabled={busy} onClick={onCancel}>
          Annuler
        </Btn>
      </ActionsBar>
    </SettingsCard>
  );
}

function DocumentDetail({
  slug,
  canEdit,
  onEdit,
  onDelete,
}: {
  slug: string;
  canEdit: boolean;
  onEdit: (d: KnowledgeDocumentDetail) => void;
  /** Suppression réservée à l'administrateur, depuis le détail uniquement. */
  onDelete?: (d: KnowledgeDocumentDetail) => void;
}) {
  const detail = useApi<KnowledgeDocumentDetail>(
    `/knowledge/documents/${slug}`,
  );
  const d = detail.data;
  return (
    <section className="card card--default gap-4 p-5" aria-label={`Document ${slug}`}>
      <Loading
        loading={detail.loading}
        error={detail.error}
        onRetry={detail.reload}
      />
      {d && (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground" aria-hidden="true">
              <FileText className="size-5" />
            </span>
            <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
              <h2 className="text-lg font-semibold text-foreground">{d.title}</h2>
              <p className="text-[13px] text-muted">
                {d.target_code
                  ? label(TARGETS, d.target_code)
                  : "Tous les programmes"}{" "}
                · {d.chunks} extraits
              </p>
            </div>
            <ActionsBar>
              {canEdit && d.source_text !== null && (
                <Btn variant="outline" size="sm" onClick={() => onEdit(d)}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Modifier
                </Btn>
              )}
              {onDelete && (
                <Btn variant="danger-soft" size="sm" onClick={() => onDelete(d)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Supprimer
                </Btn>
              )}
            </ActionsBar>
          </div>
          <details className="group rounded-xl bg-surface-secondary px-4 py-2.5 text-[13px]">
            <summary className="cursor-pointer font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus">
              Informations techniques du document
            </summary>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Identifiant</dt>
              <dd className="font-mono">{d.slug}</dd>
              <dt className="text-muted">Modèle utilisé</dt>
              <dd className="font-mono">{d.embedding_model}</dd>
            </dl>
          </details>
          <ol className="flex flex-col gap-3">
            {d.sections.map((s, i) => (
              <li key={i} className="flex gap-3 border-t border-separator pt-3 first:border-t-0 first:pt-0">
                <span className="mt-0.5 font-mono text-xs text-muted tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex flex-col gap-1">
                  <strong className="text-sm font-semibold text-foreground">{s.heading ?? "Introduction"}</strong>
                  <p className="text-[13px]/[20px] whitespace-pre-wrap text-muted">{s.text}</p>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export default function KnowledgePage() {
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";
  const status = useApi<KnowledgeStatus>("/knowledge/status");
  const docs = useApi<KnowledgeDocument[]>("/knowledge/documents");
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    slug: string;
    content: string;
    locked: boolean;
  } | null>(null);
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
              disabled={status.loading || !status.data?.configured || !!editor}
              onClick={() => setEditor({ slug: "", content: TEMPLATE, locked: false })}
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

      {editor && (
        <Editor
          key={editor.slug || "new"}
          initial={editor}
          onCancel={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setNotice("Document enregistré.");
            docs.reload();
            if (editor.slug) setSelected(editor.slug);
          }}
        />
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Loading
            loading={docs.loading}
            error={docs.error}
            onRetry={docs.reload}
          />
          <section className="card card--default gap-4 p-5" aria-label="Documents disponibles">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex-1 text-base font-semibold text-foreground">Documents disponibles</h2>
              {docs.data && (
                <span className="font-mono text-[13px] text-muted tabular-nums" role="status">
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
            {docs.data && (
              <div
                className="overflow-x-auto rounded-xl border border-separator outline-none focus-visible:ring-2 focus-visible:ring-focus"
                role="region"
                aria-label="Liste des documents"
                tabIndex={0}
              >
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <thead className="bg-surface-secondary text-left text-xs text-muted">
                    <tr>
                      <th scope="col" className={TH}>Document</th>
                      <th scope="col" className={TH}>Programme</th>
                      <th scope="col" className={`${TH} text-right`}>Extraits</th>
                      <th scope="col" className={TH}>Mis à jour</th>
                      <th scope="col" className={TH}>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((d) => {
                      const open = d.slug === selected;
                      return (
                        <tr
                          key={d.slug}
                          className={`border-t border-separator transition-colors ${open ? "bg-accent-soft/50" : "hover:bg-surface-secondary/60"}`}
                        >
                          <td className={`${TD} min-w-[240px]`}>
                            <span className="flex items-start gap-2.5">
                              <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <button
                                  type="button"
                                  aria-expanded={open}
                                  className="w-fit text-left font-medium text-foreground outline-none hover:text-accent hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus"
                                  onClick={() => setSelected(open ? null : d.slug)}
                                >
                                  {d.title}
                                </button>
                                <span className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
                                  {d.slug}
                                  {d.is_demo && <DemoChip />}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className={`${TD} whitespace-nowrap text-muted`}>
                            {d.target_code ? label(TARGETS, d.target_code) : "Tous"}
                          </td>
                          <td className={`${TD} text-right font-mono tabular-nums`}>{d.chunks}</td>
                          <td className={`${TD} font-mono text-xs whitespace-nowrap text-muted tabular-nums`}>{formatDate(d.updated_at)}</td>
                          <td className={TD}>
                            <Tag tone={d.needs_reindex ? "warning" : "success"}>
                              {d.needs_reindex ? "À recalculer" : "À jour"}
                            </Tag>
                          </td>
                        </tr>
                      );
                    })}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
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
                              <button
                                type="button"
                                className="font-medium text-link outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus"
                                onClick={() => {
                                  setQuery("");
                                  setProgramme(null);
                                }}
                              >
                                Réinitialiser les filtres
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {docs.data?.some((d) => d.is_demo) && (
              <p className="text-xs/[18px] text-muted">
                Les documents « Fictif » sont des données de démonstration : ils ne
                sont jamais utilisés en production.
              </p>
            )}
          </section>
          {selected && (
            <DocumentDetail
              key={selected}
              slug={selected}
              canEdit={isAdmin && status.data?.configured === true}
              onEdit={(d) =>
                setEditor({
                  slug: d.slug,
                  content: d.source_text ?? "",
                  locked: true,
                })
              }
              onDelete={
                isAdmin && !busy
                  ? (d) => {
                      if (
                        window.confirm(
                          `Supprimer « ${d.title} » ? L'agent ne pourra plus s'en servir.`,
                        )
                      )
                        act(async () => {
                          await api(`/knowledge/documents/${d.slug}`, {
                            method: "DELETE",
                          });
                          setSelected(null);
                        }, "Document supprimé.");
                    }
                  : undefined
              }
            />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-24">
          {status.data && <SearchTester status={status.data} />}
          {status.data && (
            <details className="card card--default gap-0 px-5 py-4 text-[13px]">
              <summary className="cursor-pointer text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus">
                Réglages techniques de la recherche
              </summary>
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
            </details>
          )}
        </aside>
      </div>
    </Screen>
  );
}
