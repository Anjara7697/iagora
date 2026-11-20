"use client";

import { toast } from "@heroui/react";
import { Download, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Btn, ErrorText, Field, FileInput, TextInput } from "@/components/ds/controls";
import { Panel } from "@/components/ds/layout";
import { api, download, failure } from "@/lib/api";
import type { CampaignFile } from "@/lib/types";

/** Limites de l'API (D-42). */
const MAX_BYTES = 4_000_000;
const MAX_FILES = 5;
const TYPES = ["application/pdf", "image/png", "image/jpeg"];

export function fileSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(bytes / 1000))} ko`;
}

/**
 * Documents que l'agent peut joindre aux emails de la campagne (D-42) : la brochure, par exemple. L'agent en joint un
 * quand il répond au besoin du prospect ; le brouillon le montre avant validation. Gardés en base, hors Git (D-28).
 */
export default function CampaignAgentFiles({ campaignId, canEdit }: { campaignId: number; canEdit: boolean }) {
  const base = `/campaigns/${campaignId}/files`;
  const [files, setFiles] = useState<CampaignFile[] | null>(null);
  const [file, setFile] = useState<File | undefined>();
  const [name, setName] = useState("");
  const [usage, setUsage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFiles(await api<CampaignFile[]>(base));
    } catch (err) {
      setError(failure("Documents indisponibles", err));
      setFiles([]);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // Le nom proposé suit le fichier choisi tant qu'il n'a pas été modifié à la main.
  const [suggested, setSuggested] = useState("");
  const choose = (chosen: File | undefined) => {
    setError(null);
    setFile(chosen);
    const proposal = chosen ? chosen.name.replace(/\.[^.]+$/, "") : "";
    if (!name.trim() || name === suggested) setName(proposal);
    setSuggested(proposal);
  };

  const fileProblem = !file
    ? null
    : !TYPES.includes(file.type)
      ? "Format refusé : PDF, PNG ou JPEG seulement."
      : file.size > MAX_BYTES
        ? "Fichier trop lourd : 4 Mo au plus."
        : null;
  const full = (files?.length ?? 0) >= MAX_FILES;

  const upload = async () => {
    if (!file || fileProblem) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("label", name.trim());
      form.append("usage", usage.trim());
      await api(base, { method: "POST", multipart: form });
      toast.success("Document ajouté", { description: "L’agent pourra le joindre à ses emails." });
      setFile(undefined);
      setName("");
      setUsage("");
      await load();
    } catch (err) {
      setError(failure("Document refusé", err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: CampaignFile) => {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/${target.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(failure("Suppression impossible", err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (target: CampaignFile) => {
    try {
      await download(`${base}/${target.id}`, target.filename);
    } catch (err) {
      setError(failure("Téléchargement impossible", err));
    }
  };

  return (
    <Panel title="Documents à joindre" label="Documents à joindre">
      <div className="flex flex-col gap-4">
        <p className="type-body-sm text-muted">
          L’agent joint un document à un email seulement s’il répond au besoin du prospect ; le brouillon le montre avant validation.
          Rien d’autre n’est joint.
        </p>
        {files === null ? (
          <p className="type-body text-muted" aria-busy="true">
            Chargement…
          </p>
        ) : files.length === 0 ? (
          <p className="type-body text-muted">Aucun document.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-separator p-3">
                <div className="min-w-0 flex-1">
                  <p className="type-body font-medium text-foreground">{f.label}</p>
                  <p className="type-body-sm break-words text-muted">
                    {f.filename} · {fileSize(f.size)}
                    {f.usage ? ` · à joindre : ${f.usage}` : ""}
                  </p>
                </div>
                <Btn size="sm" variant="tertiary" onClick={() => void save(f)} aria-label={`Télécharger ${f.label}`}>
                  <Download className="size-4" aria-hidden="true" />
                  Télécharger
                </Btn>
                {canEdit && (
                  <Btn size="sm" variant="tertiary" isIconOnly disabled={busy} aria-label={`Retirer ${f.label}`} onClick={() => void remove(f)}>
                    <X className="size-4" aria-hidden="true" />
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && !full && (
          <div className="grid grid-cols-1 items-end gap-3 rounded-lg border border-separator p-3 md:grid-cols-2">
            <Field label="Fichier" hint="PDF, PNG ou JPEG, 4 Mo au plus" className="md:col-span-2">
              <FileInput accept="application/pdf,image/png,image/jpeg" file={file} onChange={choose} buttonLabel="Choisir un document" />
            </Field>
            <Field label="Nom pour l’agent">
              <TextInput value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="ex. Brochure du programme" />
            </Field>
            <Field label="Quand le joindre">
              <TextInput value={usage} maxLength={300} onChange={(e) => setUsage(e.target.value)} placeholder="ex. quand le prospect demande le programme" />
            </Field>
            {fileProblem && <ErrorText className="md:col-span-2">{fileProblem}</ErrorText>}
            <Btn
              variant="primary"
              className="w-fit rounded-lg"
              disabled={busy || !file || !!fileProblem || !name.trim()}
              onClick={() => void upload()}
            >
              Ajouter le document
            </Btn>
          </div>
        )}
        {canEdit && full && <p className="type-body-sm text-muted">{MAX_FILES} documents au plus : retirez-en un pour en ajouter un autre.</p>}
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Panel>
  );
}
