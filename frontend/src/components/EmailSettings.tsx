"use client";

import { ChevronRight, Radar, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Btn, NativeSelect, TextInput } from "./ds/controls";
import { cx } from "./ds/layout";
import { ActionsBar, Feedback, InfoRow, SettingRow as Field, Toggle } from "./ds/settings";
import { Field as Stacked } from "./ds/controls";
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

/** Paramétrage de la boîte email depuis la console (administrateur) : aucune variable `.env`. */
export function EmailSettings({
  onSaved,
  disabled = false,
  onBusyChange,
}: {
  onSaved: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [form, setForm] = useState<EmailConfig | null>(null);
  const [password, setPassword] = useState("");
  const [sandbox, setSandbox] = useState("");
  const [detected, setDetected] = useState<EmailAutodetect | null>(null);
  const [test, setTest] = useState<EmailTestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return api<EmailConfig>("/integrations/email/config")
      .then((c) => {
        setForm(c);
        setSandbox(c.sandbox_recipients.join(", "));
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!form)
    return error ? (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-soft-foreground" role="alert">
        <span className="flex-1">{error}</span>
        <Btn size="sm" variant="outline" onClick={load}>
          Réessayer les paramètres
        </Btn>
      </div>
    ) : (
      <p className="text-sm text-muted" role="status">
        Chargement des paramètres de la boîte…
      </p>
    );

  const set = <K extends keyof EmailConfig>(key: K, value: EmailConfig[K]) => {
    setForm({ ...form, [key]: value });
    setDirty(true);
    setNotice(null);
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

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name);
    onBusyChange?.(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
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
      setNotice(
        "Boîte enregistrée. Elle est prise en compte à la prochaine relève, sans redémarrage.",
      );
      onSaved();
    });

  const forget = () =>
    act("forget", async () => {
      if (
        !window.confirm(
          "Oublier la boîte saisie ici ? Les valeurs du fichier .env du serveur s’appliqueront à nouveau.",
        )
      )
        return;
      await api("/integrations/email/config", { method: "DELETE" });
      const c = await api<EmailConfig>("/integrations/email/config");
      setForm(c);
      setPassword("");
      setSandbox(c.sandbox_recipients.join(", "));
      setTest(null);
      setDetected(null);
      setDirty(false);
      setNotice("Configuration de la console supprimée.");
      onSaved();
    });

  const ok = (v: string) => (v === "ok" ? "✓ connecté" : `✗ ${v}`);
  const folders = test?.folders ?? [];
  const hasFolder = folders.some((f) => f.name === form.imap_folder);

  return (
    <section className="flex flex-col gap-4" aria-label="Paramètres de la boîte email">
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
              setNotice(null);
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
          <details className="group rounded-xl border border-separator px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
              Paramètres avancés des serveurs
            </summary>
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
                  <NativeSelect
                    value={form.smtp_security}
                    onChange={(e) => set("smtp_security", e.target.value as "starttls" | "ssl")}
                  >
                    <option value="starttls">STARTTLS (587)</option>
                    <option value="ssl">SSL/TLS (465)</option>
                  </NativeSelect>
                </Stacked>
              </div>
            </div>
          </details>
        </InfoRow>
        <InfoRow label="Connexion" note="Rien n’est lu, envoyé ni enregistré. Le test liste les dossiers de la boîte.">
          <div className="flex flex-wrap items-center gap-3">
            <Btn size="sm" variant="outline" onClick={runTest} disabled={busy !== null}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              {busy === "test" ? "Test en cours…" : "Tester ces paramètres"}
            </Btn>
            {test && (
              <span
                aria-label="Résultat du test des paramètres"
                className={cx(
                  "font-mono text-[12.5px]",
                  test.imap === "ok" && test.smtp === "ok" ? "text-success" : "text-danger",
                )}
              >
                IMAP : {ok(test.imap)} · SMTP : {ok(test.smtp)}
              </span>
            )}
          </div>
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
            <NativeSelect
              value={hasFolder ? form.imap_folder : ""}
              onChange={(e) => set("imap_folder", e.target.value)}
            >
              {!hasFolder && <option value="">Choisir un dossier…</option>}
              {folders.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
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
              setNotice(null);
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
            <Btn onClick={forget} disabled={busy !== null}>
              Oublier cette boîte
            </Btn>
          )}
        </ActionsBar>
        <Feedback notice={notice} error={error} />
      </fieldset>
    </section>
  );
}
