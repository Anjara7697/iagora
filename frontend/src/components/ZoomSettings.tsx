"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { zoomBadge } from "@/lib/connectors";
import type { ZoomMode, ZoomSettings as Settings } from "@/lib/types";
import { Btn, NativeSelect, TextInput } from "./ds/controls";
import { ActionsBar, CodeBlock, ConnectedAccounts, Feedback, InfoRow, SettingRow as Field, StatePill } from "./ds/settings";

const MODES: Record<ZoomMode, string> = {
  none: "Aucun : rendez-vous sans lien de visioconférence",
  account: "Compte Zoom de l’école (application Server-to-Server)",
  advisor: "Compte Zoom de chaque conseiller (connexion dans Mon compte)",
};

/** Visioconférence Zoom, réglée par l'administrateur : aucune variable `.env`.
 *  `embedded` : affiché dans un panneau qui porte déjà le titre et l'état. */
export function ZoomSettings({ embedded = false }: { embedded?: boolean }) {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api<Settings>("/integrations/zoom")
      .then(setCfg)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    load();
  }, []);

  if (!cfg)
    return (
      <section data-ui="v2" className="flex flex-col gap-3" aria-label="Zoom">
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
      await api("/integrations/zoom", {
        method: "PUT",
        body: {
          mode: cfg.mode,
          account_id: cfg.account_id,
          client_id: cfg.client_id,
          client_secret: secret || null,
          host_user: cfg.host_user || "me",
        },
      });
      setSecret("");
      setNotice("Zoom enregistré : pris en compte au prochain rendez-vous.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(false);
    }
  }

  const { tone, label: badge } = zoomBadge(cfg);

  return (
    <section
      data-ui="v2"
      className={embedded ? "flex flex-col gap-4" : "card card--default gap-4 p-5"}
      aria-label="Zoom"
    >
      {!embedded && (
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-base font-semibold text-foreground">Zoom</h2>
          <StatePill tone={tone}>{badge}</StatePill>
        </div>
      )}
      <p className="text-[13px]/[20px] text-muted">
        Crée le lien de visioconférence de chaque rendez-vous réservé par
        l’agent.
        {cfg.source === "env" &&
          " Réglage actuel : fichier .env du serveur (enregistrer ici le remplace)."}
      </p>
      <Field label="Mode">
        <NativeSelect
          value={cfg.mode}
          onChange={(e) => setCfg({ ...cfg, mode: e.target.value as ZoomMode })}
        >
          {(Object.keys(MODES) as ZoomMode[]).map((m) => (
            <option key={m} value={m}>
              {MODES[m]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {cfg.mode === "account" && (
        <Field
          label="Account ID"
          note="Application « Server-to-Server OAuth » sur marketplace.zoom.us."
        >
          <TextInput
            value={cfg.account_id}
            onChange={(e) => setCfg({ ...cfg, account_id: e.target.value })}
          />
        </Field>
      )}
      {cfg.mode !== "none" && (
        <>
          <Field label="Client ID">
            <TextInput
              value={cfg.client_id}
              onChange={(e) => setCfg({ ...cfg, client_id: e.target.value })}
            />
          </Field>
          <Field
            label="Client secret"
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
        </>
      )}
      {cfg.mode === "account" && (
        <Field
          label="Hôte par défaut (email Zoom, ou « me »)"
          note="La réunion est créée au nom du conseiller s’il a un compte Zoom dans l’école, sinon au nom de cet hôte."
        >
          <TextInput
            value={cfg.host_user}
            onChange={(e) => setCfg({ ...cfg, host_user: e.target.value })}
          />
        </Field>
      )}
      {cfg.mode === "advisor" && (
        <>
          <InfoRow label="URL de redirection" note="À déclarer dans l’application Zoom (HTTPS conseillé).">
            <CodeBlock>{cfg.redirect_uri}</CodeBlock>
          </InfoRow>
          <InfoRow label="Comptes connectés">
            {cfg.connections.length === 0 ? (
              <p className="text-xs/[18px] text-muted">
                Aucun : chaque conseiller connecte le sien depuis « Mon
                compte ». Sans compte connecté, le rendez-vous est réservé
                sans lien.
              </p>
            ) : (
              <ConnectedAccounts label="Comptes Zoom connectés" items={cfg.connections} fallback="compte Zoom" />
            )}
          </InfoRow>
        </>
      )}
      <ActionsBar className="border-t border-separator pt-4">
        <Btn variant="primary" onClick={save} disabled={busy}>
          Enregistrer Zoom
        </Btn>
      </ActionsBar>
      <Feedback notice={notice} error={error} />
    </section>
  );
}
