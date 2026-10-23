"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
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
export function EmailSettings({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState<EmailConfig | null>(null);
  const [password, setPassword] = useState("");
  const [sandbox, setSandbox] = useState("");
  const [detected, setDetected] = useState<EmailAutodetect | null>(null);
  const [test, setTest] = useState<EmailTestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<EmailConfig>("/integrations/email/config")
      .then((c) => {
        setForm(c);
        setSandbox(c.sandbox_recipients.join(", "));
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );
  }, []);

  if (!form) return error ? <p className="error">{error}</p> : null;

  const set = <K extends keyof EmailConfig>(key: K, value: EmailConfig[K]) =>
    setForm({ ...form, [key]: value });

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
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Échec");
    } finally {
      setBusy(null);
    }
  }

  const detect = () =>
    act("detect", async () => {
      const d = await api<EmailAutodetect>("/integrations/email/autodetect", {
        method: "POST",
        body: { address: form.address },
      });
      setDetected(d);
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
      setSandbox(c.sandbox_recipients.join(", "));
      setNotice("Configuration de la console supprimée.");
      onSaved();
    });

  const ok = (v: string) => (v === "ok" ? "✓ connecté" : `✗ ${v}`);
  const folders = test?.folders ?? [];
  const hasFolder = folders.some((f) => f.name === form.imap_folder);

  return (
    <section aria-label="Paramètres de la boîte email">
      <h3>Paramètres de la boîte</h3>
      <p className="muted">
        {form.source === "console"
          ? "Boîte configurée dans la console."
          : "Aucune boîte enregistrée dans la console : valeurs du fichier .env du serveur."}{" "}
        Le mot de passe est chiffré et n’est jamais réaffiché.
      </p>
      <div className="form-row">
        <label>
          Adresse de la boîte
          <input
            type="email"
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="new-password"
            placeholder={form.password_set ? "•••••• (inchangé)" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Nom d’expéditeur
          <input
            value={form.from_name}
            onChange={(e) => set("from_name", e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button onClick={detect} disabled={busy !== null || !form.address}>
          Détecter les serveurs
        </button>
        {detected && (
          <span className="muted">
            {detected.provider ?? "Hébergeur inconnu"} (
            {SOURCES[detected.source]}
            ).
          </span>
        )}
      </div>
      {detected?.note && <p className="warnbox">{detected.note}</p>}
      <details open={form.source !== "console"}>
        <summary>Serveurs (avancé)</summary>
        <div className="form-row">
          <label>
            Serveur IMAP (réception)
            <input
              value={form.imap_host}
              onChange={(e) => set("imap_host", e.target.value)}
            />
          </label>
          <label>
            Port IMAP
            <input
              type="number"
              value={form.imap_port}
              onChange={(e) => set("imap_port", Number(e.target.value))}
            />
          </label>
          <label>
            Identifiant (si différent de l’adresse)
            <input
              value={form.username ?? ""}
              onChange={(e) => set("username", e.target.value || null)}
            />
          </label>
          <label>
            Serveur SMTP (envoi)
            <input
              value={form.smtp_host}
              onChange={(e) => set("smtp_host", e.target.value)}
            />
          </label>
          <label>
            Port SMTP
            <input
              type="number"
              value={form.smtp_port}
              onChange={(e) => set("smtp_port", Number(e.target.value))}
            />
          </label>
          <label>
            Sécurité SMTP
            <select
              value={form.smtp_security}
              onChange={(e) =>
                set("smtp_security", e.target.value as "starttls" | "ssl")
              }
            >
              <option value="starttls">STARTTLS (587)</option>
              <option value="ssl">SSL/TLS (465)</option>
            </select>
          </label>
        </div>
      </details>
      <div className="row">
        <button onClick={runTest} disabled={busy !== null}>
          Tester ces paramètres
        </button>
        {test && (
          <span aria-label="Résultat du test des paramètres">
            IMAP : {ok(test.imap)} · SMTP : {ok(test.smtp)}
          </span>
        )}
      </div>
      <div className="form-row">
        <label>
          Dossier surveillé
          {folders.length > 0 ? (
            <select
              value={hasFolder ? form.imap_folder : ""}
              onChange={(e) => set("imap_folder", e.target.value)}
            >
              {!hasFolder && <option value="">Choisir un dossier…</option>}
              {folders.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={form.imap_folder}
              onChange={(e) => set("imap_folder", e.target.value)}
              title="Testez la connexion pour choisir dans la liste des dossiers"
            />
          )}
        </label>
        <label>
          Bac à sable (adresses autorisées, séparées par des virgules)
          <input
            value={sandbox}
            placeholder="vide : tout destinataire"
            onChange={(e) => setSandbox(e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <label className="row">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          Relever la boîte automatiquement
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={form.send_enabled}
            onChange={(e) => set("send_enabled", e.target.checked)}
          />
          Envoyer réellement les messages validés
        </label>
      </div>
      <div className="row">
        <button className="primary" onClick={save} disabled={busy !== null}>
          Enregistrer
        </button>
        {form.source === "console" && (
          <button onClick={forget} disabled={busy !== null}>
            Oublier cette boîte
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
