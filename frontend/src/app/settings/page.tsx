"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import type { RuntimeSettings } from "@/lib/types";

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const SECRET_FIELDS = [
  "source",
  "gemini_api_key_set",
  "openai_api_key_set",
  "embedding_model",
] as const;

export default function SettingsPage() {
  const user = useCurrentUser();
  const [form, setForm] = useState<RuntimeSettings | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<{
    ok: boolean;
    model: string;
    detail: string;
  } | null>(null);
  const isAdmin = user?.role === "ADMIN";

  const load = () =>
    api<RuntimeSettings>("/settings")
      .then(setForm)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (user && !isAdmin)
    return (
      <p className="card warnbox" role="alert">
        Cette page est réservée aux administrateurs.
      </p>
    );
  if (!form) return error ? <p className="error">{error}</p> : null;

  const set = <K extends keyof RuntimeSettings>(
    key: K,
    value: RuntimeSettings[K],
  ) => setForm({ ...form, [key]: value });
  const num =
    (key: keyof RuntimeSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
      set(key, Number(e.target.value) as never);
  const days = new Set(form.calendar_work_days.split(",").filter(Boolean));
  const toggleDay = (d: number) => {
    const next = new Set(days);
    if (next.has(String(d))) next.delete(String(d));
    else next.add(String(d));
    set(
      "calendar_work_days",
      [...next].sort().join(",") || form.calendar_work_days,
    );
  };

  function payload() {
    const body: Record<string, unknown> = { ...form };
    for (const k of SECRET_FIELDS) delete body[k];
    body.gemini_api_key = geminiKey || null;
    body.openai_api_key = openaiKey || null;
    return body;
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

  const save = () =>
    act("save", async () => {
      await api("/settings", { method: "PUT", body: payload() });
      setGeminiKey("");
      setOpenaiKey("");
      setNotice("Paramètres enregistrés : appliqués immédiatement.");
      await load();
    });
  const runTest = () =>
    act("test", async () => {
      setTest(
        await api("/settings/llm/test", { method: "POST", body: payload() }),
      );
    });
  const reset = () =>
    act("reset", async () => {
      if (
        !window.confirm(
          "Revenir aux valeurs du fichier .env du serveur ? Les clés saisies ici seront oubliées.",
        )
      )
        return;
      await api("/settings", { method: "DELETE" });
      setNotice("Retour aux valeurs du serveur.");
      await load();
    });

  const keyLabel = form.llm_provider === "gemini" ? "Gemini" : "OpenAI";
  const keySet =
    form.llm_provider === "gemini"
      ? form.gemini_api_key_set
      : form.openai_api_key_set;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration · Paramètres</span>
          <h1>Paramètres</h1>
          <p className="muted">
            {form.source === "console"
              ? "Réglages enregistrés dans la console."
              : "Valeurs actuelles : fichier .env du serveur. Enregistrer ici les remplace."}{" "}
            Appliqués sans redémarrage.
          </p>
        </div>
      </div>

      <section className="card" aria-label="Intelligence artificielle">
        <h2>Intelligence artificielle</h2>
        <div className="form-row">
          <label>
            Fournisseur
            <select
              value={form.llm_provider}
              onChange={(e) =>
                set(
                  "llm_provider",
                  e.target.value as RuntimeSettings["llm_provider"],
                )
              }
            >
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label>
            Modèle principal
            <input
              value={form.llm_model}
              onChange={(e) => set("llm_model", e.target.value)}
            />
          </label>
          <label>
            Modèle de secours (si le principal est saturé)
            <input
              value={form.llm_fallback_model}
              placeholder="ex. gemini-2.5-flash-lite (vide : aucun)"
              onChange={(e) => set("llm_fallback_model", e.target.value)}
            />
          </label>
          <label>
            Clé d’API {keyLabel}
            <input
              type="password"
              autoComplete="new-password"
              placeholder={keySet ? "•••••• (inchangée)" : ""}
              value={form.llm_provider === "gemini" ? geminiKey : openaiKey}
              onChange={(e) =>
                form.llm_provider === "gemini"
                  ? setGeminiKey(e.target.value)
                  : setOpenaiKey(e.target.value)
              }
            />
          </label>
          <label>
            Créativité (0 = factuel, 1 = libre)
            <input
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={form.llm_temperature}
              onChange={num("llm_temperature")}
            />
          </label>
        </div>
        <p className="muted">
          Si le modèle principal reste indisponible (surcharge, quota) après ses
          nouveaux essais, la même demande part sur le modèle de secours avant
          tout transfert au conseiller. Recherche dans la base de connaissances
          : <code>{form.embedding_model}</code> (changer ce modèle impose de
          recalculer la base, côté serveur).
        </p>
        <div className="row">
          <button onClick={runTest} disabled={busy !== null}>
            Tester le modèle
          </button>
          {test && (
            <span
              aria-label="Résultat du test du modèle"
              className={test.ok ? "" : "error"}
            >
              {test.ok
                ? `✓ ${test.model} répond (« ${test.detail} »)`
                : `✗ ${test.detail}`}
            </span>
          )}
        </div>
      </section>

      <section className="card" aria-label="Agent et relances">
        <h2>Agent et relances</h2>
        <label className="row">
          <input
            type="checkbox"
            checked={form.agent_auto_reply}
            onChange={(e) => set("agent_auto_reply", e.target.checked)}
          />
          L’agent prépare automatiquement une réponse à chaque nouveau message
        </label>
        <div className="form-row">
          <label>
            Relances : à partir de (heure)
            <input
              type="number"
              min={0}
              max={23}
              value={form.follow_up_window_start_hour}
              onChange={num("follow_up_window_start_hour")}
            />
          </label>
          <label>
            jusqu’à (heure)
            <input
              type="number"
              min={1}
              max={24}
              value={form.follow_up_window_end_hour}
              onChange={num("follow_up_window_end_hour")}
            />
          </label>
          <label>
            Relances maximum sans réponse
            <input
              type="number"
              min={1}
              max={10}
              value={form.follow_up_max_per_silence}
              onChange={num("follow_up_max_per_silence")}
            />
          </label>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={form.follow_up_weekdays_only}
            onChange={(e) => set("follow_up_weekdays_only", e.target.checked)}
          />
          Relances en semaine uniquement
        </label>
      </section>

      <section className="card" aria-label="Emails">
        <h2>Emails</h2>
        <label>
          Mention de bas de message (désinscription)
          <textarea
            value={form.email_footer}
            rows={2}
            onChange={(e) => set("email_footer", e.target.value)}
          />
        </label>
        <div className="form-row">
          <label>
            Relève de la boîte toutes les (secondes)
            <input
              type="number"
              min={10}
              max={3600}
              value={form.email_poll_seconds}
              onChange={num("email_poll_seconds")}
            />
          </label>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={form.email_create_unknown_senders}
            onChange={(e) =>
              set("email_create_unknown_senders", e.target.checked)
            }
          />
          Un expéditeur inconnu devient un prospect
        </label>
      </section>

      <section className="card" aria-label="Disponibilités des rendez-vous">
        <h2>Disponibilités des rendez-vous</h2>
        <div className="row" role="group" aria-label="Jours ouvrés">
          {DAYS.map((d, i) => (
            <label key={d} className="row">
              <input
                type="checkbox"
                checked={days.has(String(i + 1))}
                onChange={() => toggleDay(i + 1)}
              />
              {d}
            </label>
          ))}
        </div>
        <div className="form-row">
          <label>
            Début de journée (heure)
            <input
              type="number"
              min={0}
              max={23}
              value={form.calendar_work_start_hour}
              onChange={num("calendar_work_start_hour")}
            />
          </label>
          <label>
            Fin de journée (heure)
            <input
              type="number"
              min={1}
              max={24}
              value={form.calendar_work_end_hour}
              onChange={num("calendar_work_end_hour")}
            />
          </label>
          <label>
            Durée d’un rendez-vous (minutes)
            <input
              type="number"
              min={15}
              max={240}
              step={15}
              value={form.calendar_slot_minutes}
              onChange={num("calendar_slot_minutes")}
            />
          </label>
          <label>
            Délai minimum avant un rendez-vous (heures)
            <input
              type="number"
              min={0}
              max={240}
              value={form.calendar_min_notice_hours}
              onChange={num("calendar_min_notice_hours")}
            />
          </label>
          <label>
            Créneaux proposés sur (jours)
            <input
              type="number"
              min={1}
              max={60}
              value={form.calendar_horizon_days}
              onChange={num("calendar_horizon_days")}
            />
          </label>
          <label>
            Marge entre rendez-vous (minutes)
            <input
              type="number"
              min={0}
              max={120}
              value={form.calendar_buffer_minutes}
              onChange={num("calendar_buffer_minutes")}
            />
          </label>
          <label>
            Fuseau horaire
            <input
              value={form.calendar_timezone}
              onChange={(e) => set("calendar_timezone", e.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="row">
        <button className="primary" onClick={save} disabled={busy !== null}>
          Enregistrer les paramètres
        </button>
        {form.source === "console" && (
          <button onClick={reset} disabled={busy !== null}>
            Revenir aux valeurs du serveur
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
