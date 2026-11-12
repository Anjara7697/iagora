"use client";

import { toast } from "@heroui/react";
import { useEffect, useState } from "react";
import { api, failure } from "@/lib/api";
import { calendarBadge } from "@/lib/connectors";
import type { CalendarSettings as Settings, Page } from "@/lib/types";
import { Btn, ErrorText, SelectBox, TextInput } from "./ds/controls";
import { ActionsBar, CodeBlock, ConnectedAccounts, InfoRow, SettingRow as Field, SettingsLoading, StatePill } from "./ds/settings";
import { Box } from "@/components/ds/card";

const MODES: Record<Settings["provider"], string> = {
  none: "Aucun : les demandes de rendez-vous sont transférées au conseiller",
  demo: "Démonstration : créneaux fictifs (jamais en production)",
  google: "Google Agenda de chaque conseiller",
};

/** Agenda des conseillers, réglé par l'administrateur : aucune variable `.env`.
 *  `embedded` : affiché dans un panneau qui porte déjà le titre et l'état. */
export function CalendarSettings({
  embedded = false,
  onDirtyChange,
}: {
  embedded?: boolean;
  /** Saisie non enregistrée : le panneau qui l'affiche demande confirmation avant de se fermer. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [secret, setSecret] = useState("");
  const [advisors, setAdvisors] = useState<{ id: number; username: string }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Dernière version enregistrée : sert à savoir si la saisie a changé.
  const [saved, setSaved] = useState("");
  const dirty = cfg !== null && (JSON.stringify(cfg) !== saved || secret !== "");
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const load = () => {
    setLoadError(null);
    return api<Settings>("/integrations/calendar")
      .then((c) => {
        setCfg(c);
        setSaved(JSON.stringify(c));
      })
      .catch((e) => setLoadError(failure("Chargement des réglages impossible", e)));
  };

  useEffect(() => {
    load();
    api<Page<{ id: number; username: string }>>("/advisors?limit=200")
      .then((p) => setAdvisors(p.items))
      .catch(() => setAdvisors([]));
  }, []);

  if (!cfg) return <SettingsLoading label="Agenda" error={loadError} onRetry={() => void load()} />;

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    try {
      await api("/integrations/calendar", {
        method: "PUT",
        body: {
          provider: cfg.provider,
          google_client_id: cfg.google_client_id,
          google_client_secret: secret || null,
          default_user_id: cfg.default_user_id,
        },
      });
      setSecret("");
      toast.success("Agenda enregistré", { description: "Pris en compte immédiatement." });
      await load();
    } catch (e) {
      setError(failure("Enregistrement de l’agenda impossible", e));
    } finally {
      setBusy(false);
    }
  }

  const connected = cfg.connections.length;
  const { tone, label: badge } = calendarBadge(cfg);

  return (
    <Box as="section"
      className={embedded ? "gap-4 rounded-none bg-transparent p-0 shadow-none" : "gap-4 p-5"}
      aria-label="Agenda"
    >
      {!embedded && (
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-base font-semibold text-foreground">Agenda des conseillers</h2>
          <StatePill tone={tone}>{badge}</StatePill>
        </div>
      )}
      <p className="text-[13px]/[20px] text-muted">
        Sert à proposer uniquement des créneaux réellement libres et à
        réserver le rendez-vous dans l’agenda du conseiller.
        {cfg.source === "env" &&
          " Réglage actuel : fichier .env du serveur (enregistrer ici le remplace)."}
      </p>
      <Field label="Mode">
        <SelectBox
          value={cfg.provider}
          onChange={(e) =>
            setCfg({
              ...cfg,
              provider: e.target.value as Settings["provider"],
            })
          }
        >
          {(Object.keys(MODES) as Settings["provider"][]).map((m) => (
            <option key={m} value={m}>
              {MODES[m]}
            </option>
          ))}
        </SelectBox>
      </Field>
      {cfg.provider === "google" && (
        <>
          <Field
            label="Identifiant client OAuth Google"
            note="Google Cloud → Identifiants → ID client OAuth (application Web)."
          >
            <TextInput
              value={cfg.google_client_id}
              placeholder="….apps.googleusercontent.com"
              onChange={(e) => setCfg({ ...cfg, google_client_id: e.target.value })}
            />
          </Field>
          <Field
            label="Code secret du client"
            note="Chiffré, jamais réaffiché. Vide : conserver le secret actuel."
          >
            <TextInput
              type="password"
              autoComplete="new-password"
              placeholder={cfg.client_secret_set ? "•••••• (inchangé)" : ""}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <Field
            label="Agenda par défaut (prospect sans conseiller)"
            note="Sinon, la demande de rendez-vous est transférée au conseiller."
          >
            <SelectBox
              value={cfg.default_user_id ?? ""}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  default_user_id: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">Aucun : transfert au conseiller</option>
              {advisors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </SelectBox>
          </Field>
          <InfoRow label="URI de redirection" note="À déclarer telle quelle dans l’application OAuth Google.">
            <CodeBlock>{cfg.redirect_uri}</CodeBlock>
          </InfoRow>
          <InfoRow label="Agendas connectés">
            {connected === 0 ? (
              <p className="text-xs/[18px] text-muted">
                Aucun pour l’instant : chaque conseiller connecte le sien
                depuis « Mon compte ».
              </p>
            ) : (
              <ConnectedAccounts label="Agendas connectés" items={cfg.connections} fallback="compte Google" />
            )}
          </InfoRow>
        </>
      )}
      <ActionsBar className="border-t border-separator pt-4">
        <Btn variant="primary" onClick={save} disabled={busy}>
          Enregistrer l’agenda
        </Btn>
      </ActionsBar>
      {error && <ErrorText>{error}</ErrorText>}
    </Box>
  );
}
