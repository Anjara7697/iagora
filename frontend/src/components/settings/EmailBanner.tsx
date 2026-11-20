"use client";

import { toast } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { Btn, FileInput } from "@/components/ds/controls";
import { API_URL, api, failure } from "@/lib/api";

/** Poids accepté par l'API (D-41). */
const MAX_BYTES = 400_000;

/**
 * Bandeau chargé dans Paramètres (D-41) : gardé en base (hors Git, D-28) et intégré à chaque email, sans hébergement.
 * Il remplace le bandeau dessiné et l'image hébergée ; l'aperçu de l'email le montre tel qu'il partira.
 */
export default function EmailBanner({ onChange }: { onChange?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [file, setFile] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/settings/email/banner`, { credentials: "include", cache: "no-store" });
      setSrc((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      if (res.ok) setSrc(URL.createObjectURL(await res.blob()));
    } catch {
      setSrc(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (chosen: File | undefined) => {
    setFile(chosen);
    setError(null);
    if (!chosen) return;
    if (!["image/png", "image/jpeg"].includes(chosen.type)) return setError("Format refusé : PNG ou JPEG seulement.");
    if (chosen.size > MAX_BYTES) return setError("Image trop lourde : 400 ko au plus.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", chosen);
      await api("/settings/email/banner", { method: "PUT", multipart: form });
      toast.success("Bandeau enregistré", { description: "Il sera intégré à chaque email." });
      await load();
      onChange?.();
    } catch (err) {
      setError(failure("Bandeau refusé", err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api("/settings/email/banner", { method: "DELETE" });
      setFile(undefined);
      await load();
      onChange?.();
    } catch (err) {
      setError(failure("Suppression impossible", err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- image locale (blob), pas d'optimisation Next utile
        <img src={src} alt="Bandeau actuel des emails" className="w-full max-w-[600px] rounded-sm border border-separator" />
      ) : (
        <p className="type-body-sm text-muted">Aucun bandeau chargé : le bandeau dessiné (ou l’image hébergée) est utilisé.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <FileInput
            accept="image/png,image/jpeg"
            aria-label="Bandeau des emails"
            file={file}
            onChange={(chosen) => void upload(chosen)}
            buttonLabel={src ? "Remplacer le bandeau" : "Charger un bandeau"}
            emptyLabel="PNG ou JPEG, 600 px de large, 400 ko au plus"
          />
        </div>
        {src && (
          <Btn size="sm" variant="tertiary" disabled={busy} onClick={() => void remove()}>
            Retirer le bandeau
          </Btn>
        )}
      </div>
      {error && <p className="type-body-sm text-danger">{error}</p>}
    </div>
  );
}
