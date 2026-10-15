"use client";

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
    <section className="card" aria-label="Tester une question">
      <h2>Tester une question</h2>
      <p className="muted">
        Voyez ce que l&apos;agent retrouverait pour cette question, avec le
        score de chaque extrait. Sous le seuil ({status.min_score}),
        l&apos;extrait est écarté et l&apos;agent transfère au conseiller.
      </p>
      <form className="kb-search" onSubmit={run}>
        <input
          aria-label="Question du prospect"
          placeholder="Ex. Combien de temps dure le programme ?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Programme du prospect"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">Tous les programmes</option>
          {Object.entries(TARGETS).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
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
    <section className="card" aria-label="Éditeur de document">
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
}: {
  slug: string;
  canEdit: boolean;
  onEdit: (d: KnowledgeDocumentDetail) => void;
}) {
  const detail = useApi<KnowledgeDocumentDetail>(
    `/knowledge/documents/${slug}`,
  );
  const d = detail.data;
  return (
    <section className="card" aria-label={`Document ${slug}`}>
      <Loading loading={detail.loading} error={detail.error} onRetry={detail.reload} />
      {d && (
        <>
          <div className="row">
            <h2>{d.title}</h2>
            <span className="spacer" />
            {canEdit && d.source_text !== null && (
              <button onClick={() => onEdit(d)}>Modifier</button>
            )}
          </div>
          <p className="muted">
            {d.target_code
              ? label(TARGETS, d.target_code)
              : "Tous les programmes"}{" "}
            · {d.chunks} extraits · modèle {d.embedding_model}
          </p>
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

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Intelligence · Base de connaissances</span>
          <h1>Base de connaissances</h1>
          <p className="muted">
            Les documents validés dans lesquels l&apos;agent puise ses réponses
            (RAG).
          </p>
        </div>
        {isAdmin && (
          <button
            className="primary"
            onClick={() =>
              setEditor({ slug: "", content: TEMPLATE, locked: false })
            }
          >
            Ajouter un document
          </button>
        )}
      </div>

      {status.data && !status.data.configured && (
        <p className="card warnbox" role="alert">
          Les embeddings ne sont pas configurés (clé <code>GEMINI_API_KEY</code>{" "}
          absente) : la recherche et l&apos;ajout de documents sont
          indisponibles, et l&apos;agent transfère toutes les questions
          factuelles.
        </p>
      )}
      {status.data?.configured && (
        <p className="muted">
          Modèle d&apos;embedding : <code>{status.data.embedding_model}</code> ·
          seuil de pertinence <code>{status.data.min_score}</code>
        </p>
      )}
      {needsReindex && (
        <p className="card warnbox" role="alert">
          Certains documents ont été vectorisés avec un autre modèle :
          l&apos;agent ne les voit plus.{" "}
          {isAdmin ? (
            <button
              disabled={busy}
              onClick={() =>
                act(
                  () => api("/knowledge/reindex", { method: "POST" }),
                  "Vecteurs recalculés.",
                )
              }
            >
              Recalculer les vecteurs
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
      {notice && <p role="status">{notice}</p>}

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

      <Loading loading={docs.loading} error={docs.error} onRetry={docs.reload} />
      {docs.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Programme</th>
                <th>Extraits</th>
                <th>Mis à jour</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.data.map((d) => (
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
                      {d.is_demo && <span className="badge warn">Fictif</span>}{" "}
                      {d.needs_reindex && (
                        <span className="badge warn">À recalculer</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {d.target_code ? label(TARGETS, d.target_code) : "Tous"}
                  </td>
                  <td>{d.chunks}</td>
                  <td>{formatDate(d.updated_at)}</td>
                  <td>
                    {isAdmin && (
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Supprimer « ${d.title} » ? L'agent ne pourra plus s'en servir.`,
                            )
                          )
                            act(
                              () =>
                                api(`/knowledge/documents/${d.slug}`, {
                                  method: "DELETE",
                                }),
                              "Document supprimé.",
                            );
                        }}
                      >
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {docs.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Aucun document.{" "}
                    {isAdmin
                      ? "Ajoutez le premier avec le bouton ci-dessus."
                      : ""}
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

      {selected && (
        <DocumentDetail
          key={selected}
          slug={selected}
          canEdit={isAdmin}
          onEdit={(d) =>
            setEditor({
              slug: d.slug,
              content: d.source_text ?? "",
              locked: true,
            })
          }
        />
      )}

      {status.data && <SearchTester status={status.data} />}
    </>
  );
}
