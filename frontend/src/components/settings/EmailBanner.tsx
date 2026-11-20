"use client";

import { toast } from "@heroui/react";
import { useCallback, useEffect, useId, useState } from "react";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, ErrorText, FileInput } from "@/components/ds/controls";
import { ApiError, api, apiBlob, failure } from "@/lib/api";

/** Poids accepté par l'API (D-41). */
const MAX_BYTES = 400_000;
const PATH = "/settings/email/banner";

/**
 * Bandeau chargé dans Paramètres (D-41) : gardé en base (hors Git, D-28) et intégré à chaque email, sans hébergement.
 * Il remplace le bandeau dessiné et l'image hébergée ; l'aperçu de l'email le montre tel qu'il partira.
 * Il s'enregistre dès le choix du fichier, à part du formulaire : une image refusée est signalée par une alerte reliée
 * au champ, sans `aria-invalid`, qui bloquerait l'enregistrement des autres paramètres (règle 31).
 */
export default function EmailBanner({ onChange }: { onChange?: () => void }) {
  // `undefined` : pas encore chargé (rien n'est affiché) ou illisible ; `null` : aucun bandeau chargé.
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [file, setFile] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const load = useCallback(async () => {
    let next: string | null | undefined;
    try {
      next = URL.createObjectURL(await apiBlob(PATH));
    } catch (err) {
      // 404 : aucun bandeau chargé. Toute autre erreur est dite, sans annoncer l'absence de bandeau.
      if (err instanceof ApiError && err.status === 404) next = null;
      else setError(failure("Bandeau indisponible", err));
    }
    setSrc((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return next;
    });
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
      await api(PATH, { method: "PUT", multipart: form });
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
    setError(null);
    try {
      await api(PATH, { method: "DELETE" });
      toast.success("Bandeau retiré", { description: "Les emails reprennent le bandeau dessiné (ou l’image hébergée)." });
      setFile(undefined);
      await load();
      onChange?.();
    } catch (err) {
      setError(failure("Suppression impossible", err));
    } finally {
      setBusy(false);
    }
  };

  if (src === undefined && !error) return null;

  return (
    <div className="flex flex-col gap-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- image locale (blob), pas d'optimisation Next utile
        <img src={src} alt="Bandeau actuel des emails" className="w-full max-w-[600px] rounded-sm border border-separator" />
      ) : (
        src === null && <p className="type-body-sm text-muted">Aucun bandeau chargé : le bandeau dessiné (ou l’image hébergée) est utilisé.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <FileInput
            accept="image/png,image/jpeg"
            aria-label="Bandeau des emails"
            aria-describedby={error ? errorId : undefined}
            file={file}
            onChange={(chosen) => void upload(chosen)}
            buttonLabel={src ? "Remplacer le bandeau" : "Charger un bandeau"}
            emptyLabel="PNG ou JPEG, 600 px de large, 400 ko au plus"
          />
        </div>
        {src && (
          <ConfirmDialog
            trigger={
              <Btn size="sm" variant="tertiary" disabled={busy}>
                Retirer le bandeau
              </Btn>
            }
            title="Retirer le bandeau ?"
            description="Les prochains emails reprendront le bandeau dessiné (ou l’image hébergée). Pour le remettre, il faudra charger l’image à nouveau."
            confirmLabel="Retirer"
            onConfirm={() => void remove()}
          />
        )}
      </div>
      {error && <ErrorText id={errorId}>{error}</ErrorText>}
    </div>
  );
}
