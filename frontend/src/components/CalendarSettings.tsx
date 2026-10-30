"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { calendarBadge } from "@/lib/connectors";
import type { CalendarSettings as Settings, Page } from "@/lib/types";
import { Btn, NativeSelect, TextInput } from "./ds/controls";
import { ActionsBar, CodeBlock, ConnectedAccounts, Feedback, InfoRow, SettingRow as Field, StatePill } from "./ds/settings";

const MODES: Record<Settings["provider"], string> = {
  none: "Aucun : les demandes de rendez-vous sont transférées au conseiller",
  demo: "Démonstration : créneaux fictifs (jamais en production)",
  google: "Google Agenda de chaque conseiller",
};

/** Agenda des conseillers, réglé par l'administrateur : aucune variable `.env`.
 *  `embedded` : affiché dans un panneau qui porte déjà le titre et l'état. */
export function CalendarSettings({ embedded = false }: { embedded?: boolean }) {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [secret, setSecret] = useState("");
  const [advisors, setAdvisors] = useState<{ id: number; username: string }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api<Settings>("/integrations/calendar")
      .then(setCfg)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    load();
    api<Page<{ id: number; username: string }>>("/advisors?limit=200")
      .then((p) => setAdvisors(p.items))
      .catch(() => setAdvisors([]));
  }, []);

  if (!cfg)
    return (
      <section className="flex flex-col gap-3" aria-label="Agenda">
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-sm text-muted" role="status">
            Chargement…
          </p>
        )}
      </section>
    );

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    setNotice(null);
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
      setNotice("Agenda enregistré : pris en compte immédiatement.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const connected = cfg.connections.length;
  const { tone, label: badge } = calendarBadge(cfg);

  return (
    <section
     
      className={embedded ? "flex flex-col gap-4" : "card card--default gap-4 p-5"}
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
        <NativeSelect
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
        </NativeSelect>
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
            <NativeSelect
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
            </NativeSelect>
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
      <Feedback notice={notice} error={error} />
    </section>
  );
}
