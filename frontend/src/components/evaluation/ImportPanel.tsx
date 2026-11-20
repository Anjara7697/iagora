"use client";

import { toast } from "@heroui/react";
import { Gauge } from "lucide-react";
import { useState } from "react";
import { Drawer } from "@/components/ds/Drawer";
import { Btn, ErrorText, Field, FileInput, Notice, TextBox, TextInput } from "@/components/ds/controls";
import { ActionsBar } from "@/components/ds/settings";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { api, failure } from "@/lib/api";
import { SUITES, type EvalReport, type EvalRun, type Suite } from "@/lib/evaluation";

const MAX_BYTES = 8_000_000;

/** Suite reconnue dans un rapport `--json`, comme le fait l'API (`cases`, `conversations`, `questions`). */
function detect(report: unknown): { suite: Suite; count: number } | null {
  if (!report || typeof report !== "object" || !("summary" in report)) return null;
  const r = report as EvalReport;
  if (Array.isArray(r.cases)) return { suite: "agent", count: r.cases.length };
  if (Array.isArray(r.conversations)) return { suite: "conversations", count: r.conversations.length };
  if (Array.isArray(r.questions)) return { suite: "kb", count: r.questions.length };
  return null;
}

/** Date locale pour un champ `datetime-local` (minutes). */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Importer un rapport JSON de la ligne de commande (`eval-agent`, `eval-conversations`, `kb-eval` avec `--json`) dans
 * l'historique : nom, date du passage (la date du fichier par défaut) et notes.
 */
export default function ImportPanel({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<EvalReport | null>(null);
  const [found, setFound] = useState<{ suite: Suite; count: number } | null>(null);
  const [label, setLabel] = useState("");
  const [ranAt, setRanAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { guard, dialog } = useDiscardGuard(() => open && (file !== null || notes.trim() !== ""));

  const reset = () => {
    setFile(null);
    setReport(null);
    setFound(null);
    setLabel("");
    setRanAt("");
    setNotes("");
    setError(null);
  };
  const close = () =>
    guard(() => {
      reset();
      onClose();
    });

  const choose = async (next: File | undefined) => {
    setError(null);
    setReport(null);
    setFound(null);
    setFile(next ?? null);
    if (!next) return;
    if (next.size > MAX_BYTES) {
      setError("Fichier trop volumineux (8 Mo au plus).");
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await next.text());
      const kind = detect(parsed);
      if (!kind) {
        setError("Rapport non reconnu : choisissez le fichier écrit par --json (eval-agent, eval-conversations ou kb-eval).");
        return;
      }
      setReport(parsed as EvalReport);
      setFound(kind);
      setLabel(next.name.replace(/\.json$/i, "").slice(0, 120));
      setRanAt(localInput(new Date(next.lastModified)));
    } catch {
      setError("Fichier illisible : ce n’est pas un JSON valide.");
    }
  };

  const submit = async () => {
    if (!report || !label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api<EvalRun>("/evaluations/import", {
        method: "POST",
        body: {
          label: label.trim(),
          notes,
          ran_at: ranAt ? new Date(ranAt).toISOString() : null,
          file_name: file?.name ?? null,
          report,
        },
      });
      toast.success("Rapport importé", { description: label.trim() });
      reset();
      onImported();
      onClose();
    } catch (err) {
      setError(failure("Import impossible", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Drawer open={open} onClose={close} eyebrow="Évaluation" title="Importer un rapport" icon={<Gauge aria-hidden="true" />}>
        <div className="flex flex-col gap-4">
          <p className="type-body-sm text-muted">
            Le fichier écrit par <code>--json</code> en ligne de commande, par exemple <code>conv-apres-1.json</code>. Il
            rejoint l’historique et se compare aux passages lancés depuis cette page.
          </p>
          <Field label="Fichier JSON">
            <FileInput accept="application/json,.json" file={file} onChange={(f) => void choose(f)} />
          </Field>
          {found && (
            <Notice tone="info">
              {`Reconnu : ${SUITES[found.suite]}, ${found.count} élément${found.count > 1 ? "s" : ""}.`}
            </Notice>
          )}
          {report && (
            <>
              <Field label="Nom du passage">
                <TextInput value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <Field label="Date du passage" hint="Par défaut, la date du fichier : elle place le passage sur la courbe d’évolution.">
                <TextInput type="datetime-local" value={ranAt} onChange={(e) => setRanAt(e.target.value)} />
              </Field>
              <Field label="Notes" hint="Facultatif : ce qui avait changé à ce moment-là.">
                <TextBox rows={3} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </>
          )}
          {error && <ErrorText>{error}</ErrorText>}
          <ActionsBar>
            <Btn variant="tertiary" onClick={close}>
              Annuler
            </Btn>
            <Btn variant="primary" isPending={busy} disabled={!report || !label.trim() || busy} onClick={() => void submit()}>
              Importer
            </Btn>
          </ActionsBar>
        </div>
      </Drawer>
      {dialog}
    </>
  );
}
