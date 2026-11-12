"use client";

import { toast } from "@heroui/react";
import { Radar, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, failure } from "@/lib/api";
import { ConfirmDialog } from "./ds/ConfirmDialog";
import { Btn, ErrorText, Notice, SelectBox, TextInput } from "./ds/controls";
import { cx } from "./ds/layout";
import { useDiscardGuard } from "./ds/useDiscardGuard";
import { ActionsBar, InfoRow, SettingRow as Field, SettingsLoading, Toggle } from "./ds/settings";
import { Field as Stacked } from "./ds/controls";
import { Collapse } from "@/components/ds/collapse";
import type {
  EmailAutodetect,
  EmailConfig,
  EmailTestResult,
} from "@/lib/types";

const SOURCES: Record<EmailAutodetect["source"], string> = {
  preset: "fournisseur reconnu",
  mx: "hébergeur reconnu d’après les serveurs de messagerie du domaine",
  ispdb: "base publique de configuration (Thunderbird)",
  guess: "paramètres devinés",
};

const FAILURES = {
  detect: "Détection des serveurs impossible",
  test: "Test des paramètres impossible",
  save: "Enregistrement de la boîte impossible",
  forget: "Suppression de la configuration impossible",
} as const;

/** Paramétrage de la boîte email depuis la console (administrateur) : aucune variable `.env`. */
export function EmailSettings({
  onSaved,
  disabled = false,
  onBusyChange,
  onDirtyChange,
}: {
  onSaved: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** Saisie non enregistrée : le panneau qui l'affiche demande confirmation avant de se fermer. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [form, setForm] = useState<EmailConfig | null>(null);
  const [password, setPassword] = useState("");
  const [sandbox, setSandbox] = useState("");
  const [detected, setDetected] = useState<EmailAutodetect | null>(null);
  const [test, setTest] = useState<EmailTestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { dialog: discardDialog } = useDiscardGuard(() => dirty);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const load = useCallback(() => {
    setLoadError(null);
    return api<EmailConfig>("/integrations/email/config")
      .then((c) => {
        setForm(c);
        setSandbox(c.sandbox_recipients.join(", "));
      })
      .catch((e) => setLoadError(failure("Chargement des paramètres de la boîte impossible", e)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!form) return <SettingsLoading label="Paramètres de la boîte email" error={loadError} onRetry={() => void load()} />;

  const set = <K extends keyof EmailConfig>(key: K, value: EmailConfig[K]) => {
    setForm({ ...form, [key]: value });
    setDirty(true);
    if (
      [
        "address",
        "username",
        "imap_host",
        "imap_port",
        "smtp_host",
        "smtp_port",
        "smtp_security",
      ].includes(key)
    ) {
      setTest(null);
      setDetected(null);
    }
  };

  function payload() {
    return {
      ...form,
      username: form?.username || null,
      password: password || null,
      sandbox_recipients: sandbox
        .split(/[,;\s]+/)
        .map((a) => a.trim())
        .filter(Boolean),
    };
  }

  async function act(name: keyof typeof FAILURES, fn: () => Promise<void>) {
    setBusy(name);
    onBusyChange?.(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(failure(FAILURES[name], e));
    } finally {
      setBusy(null);
      onBusyChange?.(false);
    }
  }

  const detect = () =>
    act("detect", async () => {
      setTest(null);
      setDetected(null);
      const d = await api<EmailAutodetect>("/integrations/email/autodetect", {
        method: "POST",
        body: { address: form.address },
      });
      setDetected(d);
      setDirty(true);
      setForm({
        ...form,
        imap_host: d.imap_host,
        imap_port: d.imap_port,
        smtp_host: d.smtp_host,
        smtp_port: d.smtp_port,
        smtp_security: d.smtp_security,
      });
    });

  const runTest = () =>
    act("test", async () => {
      setTest(null);
      setTest(
        await api<EmailTestResult>("/integrations/email/test", {
          method: "POST",
          body: payload(),
        }),
      );
    });

  const save = () =>
    act("save", async () => {
      const saved = await api<EmailConfig>("/integrations/email/config", {
        method: "PUT",
        body: payload(),
      });
      setForm(saved);
      setPassword("");
      setDirty(false);
      setTest(null);
      setDetected(null);
      toast.success("Boîte enregistrée", { description: "Elle est prise en compte à la prochaine relève, sans redémarrage." });
      onSaved();
    });

  const forget = () =>
    act("forget", async () => {
      await api("/integrations/email/config", { method: "DELETE" });
      const c = await api<EmailConfig>("/integrations/email/config");
      setForm(c);
      setPassword("");
      setSandbox(c.sandbox_recipients.join(", "));
      setTest(null);
      setDetected(null);
      setDirty(false);
      toast.success("Boîte de la console oubliée", { description: "Les valeurs du serveur s’appliquent à nouveau." });
      onSaved();
    });

  const ok = (v: string) => (v === "ok" ? "connecté" : v);
  const folders = test?.folders ?? [];
  const hasFolder = folders.some((f) => f.name === form.imap_folder);

  return (
    <section className="flex flex-col gap-4" aria-label="Paramètres de la boîte email">
      {discardDialog}
      <fieldset className="flex min-w-0 flex-col gap-4" disabled={busy !== null || disabled}>
        <legend className="sr-only">Configuration de la boîte email</legend>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="flex-1 text-sm font-semibold text-foreground">Paramètres de la boîte</h3>
            <span
              className={cx(
                "inline-flex items-center gap-1.5 text-xs font-medium",
                dirty ? "text-warning-soft-foreground" : "text-muted",
              )}
              role="status"
            >
              <span className={cx("size-1.5 rounded-full", dirty ? "bg-warning" : "bg-success")} aria-hidden="true" />
              {dirty
                ? "Modifications non enregistrées"
                : form.source === "console"
                  ? "Enregistrés dans la console"
                  : "Configuration du serveur"}
            </span>
          </div>
          <p className="text-[13px]/[20px] text-muted">
            Modifiez et testez ces paramètres, puis enregistrez-les pour les
            appliquer à la boîte.
          </p>
        </div>
        <Field
          label="Adresse de la boîte"
          note="N’importe quelle boîte IMAP/SMTP : les serveurs sont détectés à partir de l’adresse."
        >
          <TextInput
            type="email"
            value={form.address}
            placeholder="admissions@ecole.fr"
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <Field
          label="Mot de passe"
          note="Chiffré sur le serveur, jamais réaffiché. Gmail, Yahoo, iCloud : mot de passe d’application."
        >
          <TextInput
            type="password"
            autoComplete="new-password"
            placeholder={form.password_set ? "•••••• (inchangé)" : ""}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setDirty(true);
              setTest(null);
            }}
          />
        </Field>
        <Field label="Nom d’expéditeur" note="Affiché chez le prospect.">
          <TextInput value={form.from_name} onChange={(e) => set("from_name", e.target.value)} />
        </Field>
        <InfoRow label="Serveurs" note={detected?.note}>
          <div className="flex flex-wrap items-center gap-3">
            <Btn size="sm" variant="outline" onClick={detect} disabled={busy !== null || !form.address}>
              <Radar className="size-4" aria-hidden="true" />
              {busy === "detect" ? "Détection…" : "Détecter les serveurs"}
            </Btn>
            {detected && (
              <span className="text-[13px] text-success-soft-foreground">
                {detected.provider ?? "Hébergeur inconnu"} — {SOURCES[detected.source]}.
              </span>
            )}
          </div>
          <Collapse
  title="Paramètres avancés des serveurs"
  className="rounded-xl border border-separator px-4 py-3"
  triggerClassName="w-full text-muted hover:text-foreground"
  bodyClassName="pt-3"
>
            <div className="mt-3 flex flex-col gap-4">
              <h4 className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">Réception des messages</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
                <Stacked label="Serveur IMAP (réception)">
                  <TextInput value={form.imap_host} onChange={(e) => set("imap_host", e.target.value)} />
                </Stacked>
                <Stacked label="Port IMAP">
                  <TextInput
                    type="number"
                    value={String(form.imap_port)}
                    onChange={(e) => set("imap_port", Number(e.target.value))}
                  />
                </Stacked>
                <Stacked label="Identifiant (si différent de l’adresse)" className="sm:col-span-2">
                  <TextInput value={form.username ?? ""} onChange={(e) => set("username", e.target.value || null)} />
                </Stacked>
              </div>
              <h4 className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">Envoi des messages</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
                <Stacked label="Serveur SMTP (envoi)">
                  <TextInput value={form.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} />
                </Stacked>
                <Stacked label="Port SMTP">
                  <TextInput
                    type="number"
                    value={String(form.smtp_port)}
                    onChange={(e) => set("smtp_port", Number(e.target.value))}
                  />
                </Stacked>
                <Stacked label="Sécurité SMTP" className="sm:col-span-2">
                  <SelectBox
                    value={form.smtp_security}
                    onChange={(e) => set("smtp_security", e.target.value as "starttls" | "ssl")}
                  >
                    <option value="starttls">STARTTLS (587)</option>
                    <option value="ssl">SSL/TLS (465)</option>
                  </SelectBox>
                </Stacked>
              </div>
            </div>
</Collapse>
        </InfoRow>
        <InfoRow label="Connexion" note="Rien n’est lu, envoyé ni enregistré. Le test liste les dossiers de la boîte.">
          <div className="flex flex-wrap items-center gap-3">
            <Btn size="sm" variant="outline" onClick={runTest} disabled={busy !== null}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              {busy === "test" ? "Test en cours…" : "Tester ces paramètres"}
            </Btn>
          </div>
          {test &&
            (test.imap === "ok" && test.smtp === "ok" ? (
              <Notice aria-label="Résultat du test des paramètres">Connexion réussie : IMAP et SMTP connectés.</Notice>
            ) : (
              <ErrorText aria-label="Résultat du test des paramètres">
                {`Connexion impossible : IMAP ${ok(test.imap)} · SMTP ${ok(test.smtp)}`}
              </ErrorText>
            ))}
        </InfoRow>
        <Field
          label="Dossier surveillé"
          note={
            folders.length > 0
              ? "Seuls les emails non lus de ce dossier sont relevés."
              : "Testez la connexion pour choisir dans la liste des dossiers."
          }
        >
          {folders.length > 0 ? (
            <SelectBox
              value={hasFolder ? form.imap_folder : ""}
              onChange={(e) => set("imap_folder", e.target.value)}
            >
              {!hasFolder && <option value="">Choisir un dossier…</option>}
              {folders.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </SelectBox>
          ) : (
            <TextInput value={form.imap_folder} onChange={(e) => set("imap_folder", e.target.value)} />
          )}
        </Field>
        <Field
          label="Bac à sable (adresses autorisées, séparées par des virgules)"
          note="Pendant les essais, l’agent n’écrit qu’à ces adresses. Vide : tout destinataire."
        >
          <TextInput
            value={sandbox}
            placeholder="moi@exemple.fr, collegue@exemple.fr"
            onChange={(e) => {
              setSandbox(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Toggle
          checked={form.enabled}
          onChange={(v) => set("enabled", v)}
          title="Relever la boîte automatiquement"
          note="Les nouveaux emails deviennent des conversations ; l’agent prépare sa réponse."
        />
        <Toggle
          checked={form.send_enabled}
          onChange={(v) => set("send_enabled", v)}
          title="Envoyer réellement les messages validés"
          note="Désactivé : les réponses validées attendent, rien ne part."
        />
        <ActionsBar className="border-t border-separator pt-4">
          <Btn variant="primary" onClick={save} disabled={busy !== null}>
            Enregistrer
          </Btn>
          {form.source === "console" && (
            <ConfirmDialog
              trigger={<Btn disabled={busy !== null}>Oublier cette boîte</Btn>}
              title="Oublier la boîte saisie ici ?"
              description="Le mot de passe et les réglages enregistrés dans la console sont supprimés : les valeurs du fichier de configuration du serveur s’appliquent à nouveau."
              confirmLabel="Oublier cette boîte"
              status="warning"
              onConfirm={() => void forget()}
            />
          )}
        </ActionsBar>
        {error && <ErrorText>{error}</ErrorText>}
      </fieldset>
    </section>
  );
}
