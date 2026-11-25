"use client";

import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorText } from "../ds/controls";
import { Eyebrow } from "../ds/layout";
import { Toggle } from "../ds/settings";
import { api, ApiError } from "@/lib/api";
import { Box } from "@/components/ds/card";

type Prefs = { enabled: boolean };

/** Section « Alertes par email » de Mon compte (D-49) : chacun coupe ou rétablit les siennes. */
export function MyAlerts() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Prefs>("/auth/me/alerts")
      .then(setPrefs)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Chargement impossible"));
  }, []);

  async function change(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      setPrefs(await api<Prefs>("/auth/me/alerts", { method: "PUT", body: { enabled } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box as="section" className="gap-4 p-5" aria-label="Alertes par email">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground" aria-hidden="true">
          <BellRing className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <Eyebrow>Mes alertes</Eyebrow>
          <h2 className="type-title-sm font-semibold text-foreground">Alertes par email</h2>
        </div>
      </div>
      <p className="type-body-sm text-muted">
        Pour vos prospects : un email tout de suite en cas d’urgence (situation
        sensible, demande sur les données personnelles, prospect très chaud),
        et un récapitulatif le matin des autres transferts et des prospects
        devenus chauds.
      </p>
      {prefs && (
        <Toggle
          checked={prefs.enabled}
          onChange={change}
          isDisabled={busy}
          title="Recevoir les alertes par email"
        />
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Box>
  );
}
