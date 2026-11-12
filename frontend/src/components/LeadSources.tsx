"use client";

import { toast } from "@heroui/react";
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { API_URL, api, failure } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import type { ServiceToken } from "@/lib/types";
import { CampaignSourcePicker } from "./CampaignSourcePicker";
import { ConfirmDialog } from "./ds/ConfirmDialog";
import { Btn, ErrorText, TextInput, TextLink } from "./ds/controls";
import { ErrorState } from "./ds/layout";
import { ActionsBar, InfoRow, SecretOnce, SettingRow as Field, StatePill } from "./ds/settings";
import { Box } from "@/components/ds/card";

/** Formulaire du site, n8n et autres outils : jetons de service, sans compte utilisateur. */
export function LeadSources({
  embedded = false,
  onDirtyChange,
}: {
  embedded?: boolean;
  /** Saisie non enregistrée : le panneau qui l'affiche demande confirmation avant de se fermer. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [tokens, setTokens] = useState<ServiceToken[]>([]);
  const [name, setName] = useState("");
  const [dest, setDest] = useState<{
    campaign_id: number | null;
    source_id: number | null;
  }>({ campaign_id: null, source_id: null });
  const [created, setCreated] = useState<ServiceToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dirty = name.trim() !== "" || dest.campaign_id !== null;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const load = () => {
    setLoadError(null);
    return api<ServiceToken[]>("/integrations/tokens")
      .then(setTokens)
      .catch((e) => setLoadError(failure("Chargement des jetons impossible", e)));
  };
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const t = await api<ServiceToken>("/integrations/tokens", {
        method: "POST",
        body: { name, ...dest },
      });
      setCreated(t);
      setName("");
      setDest({ campaign_id: null, source_id: null });
      toast.success("Jeton créé", { description: "Copiez-le maintenant : il ne sera plus réaffiché." });
      await load();
    } catch (e) {
      setError(failure("Création du jeton impossible", e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: ServiceToken) {
    setError(null);
    try {
      await api(`/integrations/tokens/${t.id}`, { method: "DELETE" });
      toast.success("Jeton révoqué", { description: `Les envois avec « ${t.name} » sont désormais refusés.` });
      await load();
    } catch (e) {
      setError(failure("Révocation du jeton impossible", e));
    }
  }

  const active = tokens.filter((t) => !t.revoked_at);
  return (
    <Box as="section"
      className={embedded ? "gap-4 rounded-none bg-transparent p-0 shadow-none" : "gap-4 p-5"}
      aria-label="Formulaire et outils"
    >
      {!embedded && (
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-base font-semibold text-foreground">Formulaire du site et outils (n8n…)</h2>
          <StatePill tone={active.length ? "ok" : "off"}>
            {active.length ? `${active.length} jeton(s) actif(s)` : "Aucun jeton"}
          </StatePill>
        </div>
      )}
      <p className="text-[13px]/[20px] text-muted">
        Un jeton permet à un formulaire ou à un outil d’envoyer des prospects
        vers la campagne choisie, sans compte utilisateur. Il ne donne accès à
        rien d’autre. Pour un fichier :{" "}
        <TextLink href="/prospects/import" className="text-[13px]">importer un CSV</TextLink>.
      </p>
      {created?.token && (
        <SecretOnce
          label="Nouveau jeton"
          intro={
            <>
              Jeton de <strong>{created.name}</strong> :
            </>
          }
          secret={created.token}
          doneLabel="J’ai copié le jeton"
          onDone={() => setCreated(null)}
        >
          <pre className="overflow-x-auto rounded-xl bg-foreground px-4 py-3 font-mono text-[12px]/[18px] text-background">{`curl -X POST ${API_URL}/leads \\
  -H "Authorization: Bearer ${created.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"first_name":"Inès","email":"ines@exemple.fr","message":"Je veux des infos","consent":true}'`}</pre>
        </SecretOnce>
      )}
      <Field label="Nom du jeton" note="Ex. Formulaire du site, n8n.">
        <TextInput
          value={name}
          placeholder="Formulaire du site"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <InfoRow label="Destination" note="Les prospects reçus avec ce jeton y sont rangés automatiquement.">
        <div className="flex flex-wrap gap-3">
          <CampaignSourcePicker value={dest} onChange={setDest} />
        </div>
      </InfoRow>
      <ActionsBar className="border-t border-separator pt-4">
        <Btn variant="primary" onClick={create} disabled={busy || name.trim().length < 2 || (!!dest.campaign_id && !dest.source_id)}>
          <KeyRound className="size-4" aria-hidden="true" />
          Créer un jeton
        </Btn>
      </ActionsBar>
      {error && <ErrorText>{error}</ErrorText>}
      {loadError && <ErrorState message={loadError} onRetry={() => void load()} />}
      {tokens.length > 0 && (
        <div aria-label="Jetons de service" role="list" className="flex flex-col gap-2">
          {tokens.map((t) => (
            <div
              className="flex flex-wrap items-center gap-3 rounded-xl border border-separator px-4 py-3"
              role="listitem"
              key={t.id}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong className="text-sm font-semibold text-foreground">{t.name}</strong>
                <span className="text-xs text-muted">
                  <code className="rounded bg-surface-tertiary px-1 font-mono">{t.hint}</code> · créé le {formatDate(t.created_at)} ·
                  dernier envoi {formatDate(t.last_used_at)}
                </span>
              </span>
              {t.revoked_at ? (
                <StatePill tone="warn">Révoqué</StatePill>
              ) : (
                <ConfirmDialog
                  trigger={
                    <Btn size="sm" variant="danger-soft">
                      Révoquer
                    </Btn>
                  }
                  title={`Révoquer « ${t.name} » ?`}
                  description="Les envois avec ce jeton seront refusés immédiatement. Le formulaire ou l’outil qui l’utilise devra recevoir un nouveau jeton."
                  confirmLabel="Révoquer"
                  onConfirm={() => void revoke(t)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Box>
  );
}
