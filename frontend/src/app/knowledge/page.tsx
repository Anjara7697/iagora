"use client";

import Link from "next/link";
import { useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
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

function ScoreBar({ score, threshold }: { score: number; threshold: number }) {
  return (
    <div className="score-bar" aria-hidden="true">
      <div style={{ width: `${Math.round(score * 100)}%` }} />
      <span style={{ left: `${Math.round(threshold * 100)}%` }} />
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
    <section className="card kb-tester" aria-label="Tester une question">
      <h2>Tester une question</h2>
      <p className="muted">
        Vérifiez quelles sources l’agent peut utiliser avant de répondre à un
        prospect. Les extraits trop peu pertinents sont écartés.
      </p>
      <form className="kb-search" onSubmit={run}>
        <label>
          Question du prospect
          <input
            placeholder="Ex. Combien de temps dure le programme ?"
            value={query}
            disabled={busy}
            onChange={(e) => {
              setQuery(e.target.value);
              setResult(null);
            }}
          />
        </label>
        <label>
          Programme du prospect
          <select
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
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || query.trim().length < 2 || !status.configured}
        >
          {busy ? "Recherche…" : "Tester"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && result.results.length === 0 && (
        <p className="muted">
          Aucun extrait : la base est vide pour ce programme, ou les vecteurs
          sont à recalculer.
        </p>
      )}
      <ul className="kb-results">
        {result?.results.map((hit, i) => (
          <li key={i} className={hit.retained ? "retained" : "dropped"}>
            <div className="row">
              <strong>{hit.source}</strong>
              <span className={`badge ${hit.retained ? "risk-low" : ""}`}>
                {hit.retained ? "Retenu" : "Écarté (sous le seuil)"}
              </span>
              <span className="mono">{hit.score.toFixed(3)}</span>
            </div>
            <ScoreBar score={hit.score} threshold={result.threshold} />
            <p className="muted">{hit.text}</p>
          </li>
        ))}
      </ul>
    </section>
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
    <section className="card kb-editor-panel" aria-label="Éditeur de document">
      <h2>
        {initial.locked
          ? `Modifier « ${initial.slug} »`
          : "Ajouter un document"}
      </h2>
      <div className="form">
        <label>
          Identifiant (lettres minuscules, chiffres, tirets)
          <input
            aria-label="Identifiant du document"
            value={slug}
            disabled={initial.locked}
            onChange={(e) => setSlug(slugify(e.target.value))}
          />
        </label>
        <label>
          Charger un fichier .md
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            onChange={(e) => load(e.target.files?.[0])}
          />
        </label>
      </div>
      <textarea
        className="kb-editor"
        aria-label="Contenu du document"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <p className="muted">
        En-tête obligatoire : <code>title:</code>, et <code>target:</code> pour
        limiter le document à un programme (
        <code>{Object.keys(TARGETS).join(" | ")}</code>, ou omis pour tous). Une
        section = un titre <code>##</code>.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button
          className="primary"
          disabled={busy || !slug || content.trim().length < 10}
          onClick={save}
        >
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button disabled={busy} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </section>
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
    <section className="card" aria-label={`Document ${slug}`}>
      <Loading
        loading={detail.loading}
        error={detail.error}
        onRetry={detail.reload}
      />
      {d && (
        <>
          <div className="row">
            <h2>{d.title}</h2>
            <span className="spacer" />
            {canEdit && d.source_text !== null && (
              <button onClick={() => onEdit(d)}>Modifier</button>
            )}
            {onDelete && (
              <button className="danger" onClick={() => onDelete(d)}>
                Supprimer
              </button>
            )}
          </div>
          <p className="muted">
            {d.target_code
              ? label(TARGETS, d.target_code)
              : "Tous les programmes"}{" "}
            · {d.chunks} extraits
          </p>
          <details className="kb-technical">
            <summary>Informations techniques du document</summary>
            <dl>
              <dt>Identifiant</dt>
              <dd>{d.slug}</dd>
              <dt>Modèle utilisé</dt>
              <dd>{d.embedding_model}</dd>
            </dl>
          </details>
          <ol className="kb-sections">
            {d.sections.map((s, i) => (
              <li key={i}>
                <strong>{s.heading ?? "Introduction"}</strong>
                <p className="muted">{s.text}</p>
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
    <>
      <div className="page-heading kb-heading">
        <div>
          <span className="eyebrow">Intelligence · Base de connaissances</span>
          <h1>Base de connaissances</h1>
          <p className="muted">
            Les sources de référence utilisées par l’agent pour répondre aux
            questions des prospects.
          </p>
        </div>
        {isAdmin && (
          <div className="page-actions">
            <button
              className="primary"
              disabled={status.loading || !status.data?.configured || !!editor}
              onClick={() =>
                setEditor({ slug: "", content: TEMPLATE, locked: false })
              }
            >
              Ajouter un document
            </button>
          </div>
        )}
      </div>

      <Loading
        loading={status.loading}
        error={status.error}
        onRetry={status.reload}
      />
      {gapCount > 0 && (
        <div className="card kb-gap" role="status">
          <div>
            <strong>
              {gapCount} demande{gapCount > 1 ? "s nécessitent" : " nécessite"}{" "}
              une source fiable
            </strong>
            <p className="muted">
              L’agent a transmis ces questions à un conseiller faute de source
              suffisante.
            </p>
          </div>
          <Link className="button-link" href="/todo?kind=kb_gap">
            Traiter la demande
          </Link>
        </div>
      )}
      {status.data && !status.data.configured && (
        <p className="card warnbox" role="alert">
          La recherche et l’ajout de documents sont indisponibles : le service
          de recherche n’est pas configuré. L’agent transmet les questions
          factuelles à un conseiller.{" "}
          {isAdmin ? (
            <Link href="/settings">Configurer dans les paramètres</Link>
          ) : (
            "Contactez un administrateur pour l’activer."
          )}
        </p>
      )}
      {needsReindex && (
        <p className="card warnbox" role="alert">
          Certains documents doivent être actualisés avant de pouvoir être
          utilisés par l’agent.{" "}
          {isAdmin ? (
            <button
              disabled={busy}
              onClick={() =>
                act(
                  () => api("/knowledge/reindex", { method: "POST" }),
                  "Documents actualisés.",
                )
              }
            >
              Actualiser les documents
            </button>
          ) : (
            "Demandez à un administrateur de les recalculer."
          )}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="kb-notice" role="status">
          {notice}
        </p>
      )}

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

      <Loading
        loading={docs.loading}
        error={docs.error}
        onRetry={docs.reload}
      />
      <section className="kb-library" aria-label="Documents disponibles">
        <div className="kb-library-head">
          <h2>Documents disponibles</h2>
          {docs.data && (
            <span className="muted" role="status">
              {shown.length} document{shown.length > 1 ? "s" : ""}
              {programme !== null || query ? " affiché(s)" : ""}
            </span>
          )}
        </div>
        {docs.data && docs.data.length > 0 && (
          <label className="kb-document-search">
            Rechercher un document
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Titre ou identifiant…"
            />
          </label>
        )}
        {docs.data && programmes.length > 1 && (
          <div className="chips" role="group" aria-label="Programme">
            <button
              aria-pressed={programme === null}
              onClick={() => setProgramme(null)}
            >
              Toutes
            </button>
            {programmes.map((code) => (
              <button
                key={code}
                aria-pressed={programme === code}
                onClick={() => setProgramme(code)}
              >
                {code ? label(TARGETS, code) : "Documents communs"}
              </button>
            ))}
          </div>
        )}
        {docs.data && shown.length > 0 && (
          <p className="kb-table-hint muted">
            Faites défiler le tableau pour voir le statut et les actions.
          </p>
        )}
        {docs.data && (
          <div
            className="table-wrap"
            role="region"
            aria-label="Liste des documents"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Programme</th>
                  <th>Extraits</th>
                  <th>Mis à jour</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.slug}>
                    <td>
                      <button
                        className="link"
                        onClick={() =>
                          setSelected(d.slug === selected ? null : d.slug)
                        }
                      >
                        {d.title}
                      </button>
                      <div className="muted">
                        {d.slug}{" "}
                        {d.is_demo && (
                          <span className="badge warn">Fictif</span>
                        )}{" "}
                      </div>
                    </td>
                    <td>
                      {d.target_code ? label(TARGETS, d.target_code) : "Tous"}
                    </td>
                    <td>{d.chunks}</td>
                    <td>{formatDate(d.updated_at)}</td>
                    <td>
                      <span
                        className={`badge ${d.needs_reindex ? "integ-warn" : "integ-ok"}`}
                      >
                        {d.needs_reindex ? "À recalculer" : "À jour"}
                      </span>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
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
                            className="link"
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
          <p className="muted">
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

      {status.data && <SearchTester status={status.data} />}
      {status.data && (
        <details className="kb-technical">
          <summary>Réglages techniques de la recherche</summary>
          <p className="muted">
            Ces informations expliquent comment les extraits sont sélectionnés.
          </p>
          <dl>
            <dt>Modèle de recherche</dt>
            <dd>{status.data.embedding_model ?? "Non configuré"}</dd>
            <dt>Seuil de pertinence</dt>
            <dd>{status.data.min_score}</dd>
            <dt>Extraits recherchés par défaut</dt>
            <dd>{status.data.top_k}</dd>
          </dl>
        </details>
      )}
    </>
  );
}
