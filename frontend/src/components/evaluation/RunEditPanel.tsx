"use client";

import { toast } from "@heroui/react";
import { Gauge } from "lucide-react";
import { useState } from "react";
import { Drawer } from "@/components/ds/Drawer";
import { Btn, ErrorText, Field, TextBox, TextInput } from "@/components/ds/controls";
import { ActionsBar } from "@/components/ds/settings";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { api, failure } from "@/lib/api";
import type { EvalRun } from "@/lib/evaluation";

function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Modifier un passage (règle 1 : toujours dans un panneau) : nom, date (place sur la courbe), notes. */
export default function RunEditPanel({
  run,
  open,
  onClose,
  onSaved,
}: {
  run: EvalRun;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = { label: run.label, ranAt: localInput(run.ran_at), notes: run.notes ?? "" };
  const [form, setForm] = useState(initial);
  const [seen, setSeen] = useState(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Réouverture : le formulaire repart des valeurs du passage.
  if (open !== seen) {
    setSeen(open);
    if (open) {
      setForm(initial);
      setError(null);
    }
  }
  const dirty = form.label !== initial.label || form.ranAt !== initial.ranAt || form.notes !== initial.notes;
  const { guard, dialog } = useDiscardGuard(() => open && dirty);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/evaluations/${run.id}`, {
        method: "PATCH",
        body: { label: form.label.trim(), notes: form.notes, ran_at: form.ranAt ? new Date(form.ranAt).toISOString() : null },
      });
      toast.success("Passage modifié", { description: form.label.trim() });
      onSaved();
    } catch (err) {
      setError(failure("Enregistrement impossible", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Drawer open={open} onClose={() => guard(onClose)} eyebrow="Modification" title={run.label} icon={<Gauge aria-hidden="true" />}>
        <div className="flex flex-col gap-4">
          <Field label="Nom du passage">
            <TextInput value={form.label} maxLength={120} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <Field label="Date du passage" hint="Elle place le passage sur la courbe d’évolution.">
            <TextInput type="datetime-local" value={form.ranAt} onChange={(e) => setForm({ ...form, ranAt: e.target.value })} />
          </Field>
          <Field label="Notes">
            <TextBox rows={4} value={form.notes} maxLength={4000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
          <ActionsBar>
            <Btn variant="tertiary" onClick={() => guard(onClose)}>
              Annuler
            </Btn>
            <Btn variant="primary" isPending={busy} disabled={!dirty || !form.label.trim() || busy} onClick={() => void save()}>
              Enregistrer
            </Btn>
          </ActionsBar>
        </div>
      </Drawer>
      {dialog}
    </>
  );
}
