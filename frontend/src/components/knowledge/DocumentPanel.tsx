"use client";

import { toast } from "@heroui/react";
import { BookOpen, Pencil, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { DemoChip } from "@/components/ds/badges";
import { Box } from "@/components/ds/card";
import { Collapse } from "@/components/ds/collapse";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, ErrorText, Field, FileInput, SelectBox, Tag, TextBox, TextInput } from "@/components/ds/controls";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { ActionsBar } from "@/components/ds/settings";
import { Drawer } from "@/components/Drawer";
import { Loading } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { BODY_TEMPLATE, SLUG_PATTERN, composeDocument, slugify, splitDocument, type DocumentParts } from "@/lib/knowledgeDoc";
import { TARGETS, formatDate, label } from "@/lib/labels";
import type { KnowledgeDocument, KnowledgeDocumentDetail } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/**
 * Panneau latéral d'un document : fiche (sections, statut), puis modification dans le même panneau ; ou création.
 * Quitter avec une saisie non enregistrée demande confirmation. Un identifiant déjà utilisé bloque la création
 * (l'API remplacerait le document existant sans prévenir).
 */
export default function DocumentPanel({
  slug,
  creating,
  documents,
  canEdit,
  canDelete,
  onClose,
  onOpen,
  onSaved,
  onDeleted,
}: {
  /** Document ouvert (adresse `?doc=`) ; `null` à la création. */
  slug: string | null;
  creating: boolean;
  documents: KnowledgeDocument[];
  /** Administrateur et service de recherche configuré (l'enregistrement calcule les vecteurs). */
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onOpen: (slug: string) => void;
  onSaved: (slug: string) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const dirty = useRef(false);
  const { guard, dialog } = useDiscardGuard(() => (creating || editing) && dirty.current);
  const detail = useApi<KnowledgeDocumentDetail>(slug && !creating ? `/knowledge/documents/${slug}` : null);
  const d = detail.data;
  const open = creating || !!slug;
  const edit = creating || editing;

  const close = () =>
    guard(() => {
      setEditing(false);
      onClose();
    });

  return (
    <>
      <Drawer
        open={open}
        onClose={close}
        eyebrow={creating ? "Nouveau document" : editing ? "Modification" : "Document"}
        title={creating ? "Ajouter un document" : (d?.title ?? "Document")}
        icon={<BookOpen aria-hidden="true" />}
      >
        {edit ? (
          creating || d ? (
            <DocumentEditor
              key={creating ? "new" : `${d?.slug}-${version}`}
              initial={creating ? null : (d ?? null)}
              documents={documents}
              dirtyRef={dirty}
              onOpen={(other) => guard(() => onOpen(other))}
              onCancel={() => guard(() => (creating ? onClose() : setEditing(false)))}
              onSaved={(saved) => {
                dirty.current = false;
                setEditing(false);
                setVersion((v) => v + 1);
                detail.reload();
                onSaved(saved);
              }}
            />
          ) : null
        ) : (
          <>
            <Loading loading={detail.loading && !d} error={detail.error} onRetry={detail.reload} />
            {d && (
              <DocumentView
                doc={d}
                canEdit={canEdit && d.source_text !== null}
                canDelete={canDelete}
                onEdit={() => setEditing(true)}
                onDelete={async () => {
                  try {
                    await api(`/knowledge/documents/${d.slug}`, { method: "DELETE" });
                    toast.success("Document supprimé", { description: `« ${d.title} » n’est plus utilisé par l’agent.` });
                    onDeleted();
                  } catch (err) {
                    toast.danger("Suppression impossible", { description: err instanceof ApiError ? err.message : "Réessayez." });
                  }
                }}
              />
            )}
          </>
        )}
      </Drawer>
      {dialog}
    </>
  );
}

function DocumentView({
  doc,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  doc: KnowledgeDocumentDetail;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Tag tone="neutral">{doc.target_code ? label(TARGETS, doc.target_code) : "Tous les programmes"}</Tag>
        <Tag tone={doc.needs_reindex ? "warning" : "success"}>{doc.needs_reindex ? "À recalculer" : "À jour"}</Tag>
        {doc.is_demo && <DemoChip />}
        <span>
          {doc.chunks} extrait{doc.chunks > 1 ? "s" : ""}
          {doc.updated_at ? ` · mis à jour le ${formatDate(doc.updated_at)}` : ""}
        </span>
      </div>
      {(canEdit || canDelete) && (
        <ActionsBar>
          {canEdit && (
            <Btn variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              Modifier
            </Btn>
          )}
          {canDelete && (
            <ConfirmDialog
              trigger={
                <Btn variant="danger-soft" size="sm">
                  <Trash2 className="size-4" aria-hidden="true" />
                  Supprimer
                </Btn>
              }
              title={`Supprimer « ${doc.title} » ?`}
              description="L’agent ne pourra plus s’en servir pour répondre aux prospects. Cette action est définitive."
              confirmLabel="Supprimer"
              onConfirm={onDelete}
            />
          )}
        </ActionsBar>
      )}
      <Box as="section" aria-label="Contenu du document" className="gap-0 rounded-lg p-0">
        <ol className="flex flex-col">
          {doc.sections.map((s, i) => (
            <li key={i} className="flex gap-3 border-t border-separator px-4 py-3 first:border-t-0">
              <span className="mt-0.5 text-xs text-muted tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex min-w-0 flex-col gap-1">
                <strong className="text-sm font-semibold text-foreground">{s.heading ?? "Introduction"}</strong>
                <p className="text-[13px]/[20px] whitespace-pre-wrap text-muted">{s.text}</p>
              </span>
            </li>
          ))}
        </ol>
      </Box>
      <Collapse
        title="Informations techniques"
        className="rounded-lg bg-surface px-4 py-2.5 text-[13px]"
        triggerClassName="w-full text-muted hover:text-foreground"
      >
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">Identifiant</dt>
          <dd className="font-mono">{doc.slug}</dd>
          <dt className="text-muted">Modèle de recherche</dt>
          <dd className="font-mono break-all">{doc.embedding_model}</dd>
        </dl>
      </Collapse>
    </div>
  );
}

function DocumentEditor({
  initial,
  documents,
  dirtyRef,
  onOpen,
  onCancel,
  onSaved,
}: {
  /** Document à modifier ; `null` à la création. */
  initial: KnowledgeDocumentDetail | null;
  documents: KnowledgeDocument[];
  dirtyRef: RefObject<boolean>;
  onOpen: (slug: string) => void;
  onCancel: () => void;
  onSaved: (slug: string) => void;
}) {
  // Titre et programme : ceux que l'API a retenus pour ce document ; corps et autres lignes : le texte source.
  const start: DocumentParts = initial?.source_text
    ? { ...splitDocument(initial.source_text), title: initial.title, target: initial.target_code ?? "" }
    : { title: "", target: "", body: BODY_TEMPLATE, extra: [] };
  const [parts, setParts] = useState<DocumentParts>(start);
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = initial !== null;

  const dirty = JSON.stringify(parts) !== JSON.stringify(start) || (!locked && slug !== "");
  useLayoutEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty, dirtyRef]);

  const taken = !locked && documents.some((d) => d.slug === slug);
  const slugValid = SLUG_PATTERN.test(slug);
  const valid = parts.title.trim().length > 0 && slugValid && !taken && parts.body.trim().length >= 10;
  const set = (patch: Partial<DocumentParts>) => setParts((p) => ({ ...p, ...patch }));

  async function load(file: File | undefined) {
    if (!file) return;
    setPicked(file);
    const read = splitDocument(await file.text());
    setParts((p) => ({ ...read, title: read.title || p.title, target: read.title ? read.target : p.target }));
    if (!locked && !slugTouched) setSlug(slugify(read.title || file.name));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ chunks: number }>(`/knowledge/documents/${slug}`, {
        method: "PUT",
        body: { content: composeDocument(parts) },
      });
      toast.success("Document enregistré", {
        description: `${result.chunks} extrait${result.chunks > 1 ? "s" : ""} disponible${result.chunks > 1 ? "s" : ""} pour l’agent.`,
      });
      onSaved(slug);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l’enregistrement");
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      aria-label={locked ? "Modifier le document" : "Nouveau document"}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void save();
      }}
    >
      <Field label="Titre">
        <TextInput
          variant="primary"
          value={parts.title}
          maxLength={200}
          placeholder="ex. Programme eBIHAR"
          onChange={(e) => {
            set({ title: e.target.value });
            if (!locked && !slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Programme" hint="Limite le document à un programme, ou le rend commun à tous.">
          <SelectBox variant="primary" value={parts.target} onChange={(e) => set({ target: e.target.value })}>
            <option value="">Tous les programmes</option>
            {Object.entries(TARGETS).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field
          label="Identifiant"
          hint={
            locked ? (
              "Fixé à la création."
            ) : taken ? (
              <span className="flex flex-wrap items-center gap-x-2 text-danger">
                Un document porte déjà cet identifiant.
                <Btn variant="ghost" size="sm" className="h-auto rounded-lg px-1 py-0 text-link" onClick={() => onOpen(slug)}>
                  Ouvrir ce document
                </Btn>
              </span>
            ) : slug && !slugValid ? (
              <span className="text-danger">Lettres minuscules, chiffres et tirets uniquement.</span>
            ) : (
              "Déduit du titre ; lettres minuscules, chiffres et tirets."
            )
          }
        >
          <TextInput
            variant="primary"
            value={slug}
            disabled={locked}
            aria-invalid={taken || (!!slug && !slugValid) || undefined}
            className="font-mono"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
          />
        </Field>
      </div>
      <Field label="Charger un fichier .md" hint="Remplit le titre, le programme et le contenu à partir du fichier.">
        <FileInput accept=".md,text/markdown,text/plain" file={picked} onChange={(f) => void load(f)} />
      </Field>
      <Field label="Contenu" hint="Une section par titre « ## ». Un fait par phrase claire : l’agent cite ces extraits.">
        <TextBox
          variant="primary"
          value={parts.body}
          onChange={(e) => set({ body: e.target.value })}
          className="min-h-[320px] font-mono text-[13px]/[20px]"
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <ActionsBar className="border-t border-separator pt-4">
        <Btn variant="primary" type="submit" disabled={busy || !valid}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </Btn>
        <Btn variant="ghost" disabled={busy} onClick={onCancel}>
          Annuler
        </Btn>
      </ActionsBar>
    </form>
  );
}
