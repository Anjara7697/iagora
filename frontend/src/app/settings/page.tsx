"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TestingAccess from "@/components/TestingAccess";
import { canUseSimulator } from "@/lib/access";
import { Suspense, useEffect, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { Feedback, Field, Section, Toggle } from "@/components/forms";
import { api, ApiError } from "@/lib/api";
import type { RuntimeSettings } from "@/lib/types";

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const READ_ONLY = [
  "source",
  "gemini_api_key_set",
  "openai_api_key_set",
  "embedding_model",
] as const;

const SECTIONS = [
  {
    id: "ia",
    label: "Intelligence artificielle",
    hint: "Modèle, clé, secours",
  },
  { id: "agent", label: "Agent et relances", hint: "Réponses et relances" },
  { id: "emails", label: "Emails", hint: "Pied, mise en page, relève" },
  { id: "rdv", label: "Rendez-vous", hint: "Jours et horaires" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();
  const requested = useSearchParams().get("section");
  const active: SectionId =
    SECTIONS.find((s) => s.id === requested)?.id ?? SECTIONS[0].id;
  const [form, setForm] = useState<RuntimeSettings | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [test, setTest] = useState<{
    ok: boolean;
    model: string;
    detail: string;
  } | null>(null);
  const isAdmin = user?.role === "ADMIN";

  const load = () =>
    api<RuntimeSettings>("/settings")
      .then((s) => {
        setForm(s);
        setDirty(false);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Chargement impossible"),
      );

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (user && !isAdmin)
    return canUseSimulator(user.role) ? (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">Réglages · Outils de test</span>
            <h1>Paramètres</h1>
            <p className="muted">
              Retrouvez les outils pour essayer l’agent avec des données
              fictives.
            </p>
          </div>
        </div>
        <TestingAccess />
      </>
    ) : (
      <p className="ui-card warnbox" role="alert">
        Cette page est réservée aux administrateurs.
      </p>
    );
  if (!form)
    return (
      <>
        <h1>Paramètres</h1>
        <TestingAccess />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted" role="status">
            Chargement des réglages…
          </p>
        )}
      </>
    );

  const set = <K extends keyof RuntimeSettings>(
    key: K,
    value: RuntimeSettings[K],
  ) => {
    setForm({ ...form, [key]: value });
    setDirty(true);
  };
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
    for (const k of READ_ONLY) delete body[k];
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
      await load();
      setNotice("Paramètres enregistrés : appliqués immédiatement.");
    });
  const runTest = () =>
    act("test", async () => {
      setTest(
        await api("/settings/llm/test", { method: "POST", body: payload() }),
      );
    });
  const showPreview = () =>
    act("preview", async () => {
      const r = await api<{ html: string }>("/settings/email/preview", {
        method: "POST",
        body: payload(),
      });
      setPreview(r.html);
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
      await load();
      setNotice("Retour aux valeurs du serveur.");
    });

  const gemini = form.llm_provider === "gemini";
  const keySet = gemini ? form.gemini_api_key_set : form.openai_api_key_set;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administration · Paramètres</span>
          <h1>Paramètres</h1>
          <p className="muted">
            Réglages de l’agent, appliqués sans redémarrage.{" "}
            {form.source === "console"
              ? "Enregistrés dans la console."
              : "Valeurs par défaut du serveur : enregistrer ici les remplace."}
          </p>
        </div>
      </div>

      <div className="settings-layout">
        <label className="settings-select">
          Catégorie
          <select
            value={active}
            onChange={(e) =>
              router.replace(`${pathname}?section=${e.target.value}`, {
                scroll: false,
              })
            }
          >
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <nav className="settings-nav" aria-label="Catégories de paramètres">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              href={`${pathname}?section=${s.id}`}
              replace
              scroll={false}
              aria-current={active === s.id ? "page" : undefined}
            >
              <span>{s.label}</span>
              <small>{s.hint}</small>
            </Link>
          ))}
          <TestingAccess compact disabled={busy !== null} unsaved={dirty} />
        </nav>
        <div className="settings-stack settings-content">
          <Section
            region="Intelligence artificielle"
            hidden={active !== "ia"}
            label="Intelligence artificielle"
            intro="Le modèle rédige les réponses et lit les messages. Si le modèle principal reste indisponible (surcharge, quota) après ses nouveaux essais, la même demande part sur le modèle de secours avant tout transfert au conseiller."
          >
            <Field label="Fournisseur">
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
            </Field>
            <Field label="Modèle principal" note="Ex. gemini-2.5-flash.">
              <input
                value={form.llm_model}
                onChange={(e) => set("llm_model", e.target.value)}
              />
            </Field>
            <Field
              label="Modèle de secours (si le principal est saturé)"
              note="Même fournisseur et même clé, ex. gemini-2.5-flash-lite. Vide : aucun secours."
            >
              <input
                value={form.llm_fallback_model}
                placeholder="gemini-2.5-flash-lite"
                onChange={(e) => set("llm_fallback_model", e.target.value)}
              />
            </Field>
            <Field
              label={`Clé d’API ${gemini ? "Gemini" : "OpenAI"}`}
              note="Chiffrée sur le serveur, jamais réaffichée. Laisser vide pour conserver la clé actuelle."
            >
              <input
                type="password"
                autoComplete="new-password"
                placeholder={
                  keySet ? "•••••• (inchangée)" : "Aucune clé enregistrée"
                }
                value={gemini ? geminiKey : openaiKey}
                onChange={(e) => {
                  (gemini ? setGeminiKey : setOpenaiKey)(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field
              label="Créativité (0 = factuel, 1 = libre)"
              note="0,2 à 0,4 recommandé : l’agent ne doit jamais inventer."
            >
              <input
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={form.llm_temperature}
                onChange={num("llm_temperature")}
              />
            </Field>
            <div className="field-row">
              <span className="field-label">Recherche documentaire</span>
              <div className="field-control">
                <span className="mono">{form.embedding_model}</span>
                <p className="field-note">
                  Réglé sur le serveur : en changer impose de recalculer la base
                  de connaissances.
                </p>
              </div>
            </div>
            <div className="actions-bar">
              <button onClick={runTest} disabled={busy !== null}>
                {busy === "test" ? "Test en cours…" : "Tester le modèle"}
              </button>
              {test && (
                <span
                  aria-label="Résultat du test du modèle"
                  className={`status-text ${test.ok ? "status-ok" : "status-bad"}`}
                >
                  {test.ok
                    ? `✓ ${test.model} répond (« ${test.detail} »)`
                    : `✗ ${test.detail}`}
                </span>
              )}
            </div>
          </Section>

          <Section
            region="Agent et relances"
            hidden={active !== "agent"}
            label="Agent et relances"
            intro="Chaque relance reste un brouillon soumis à validation en mode assisté ; elles s’arrêtent dès que le prospect répond, se désinscrit ou est transféré."
          >
            {canUseSimulator(user?.role) && (
              <div className="settings-test-link">
                {dirty || busy !== null ? (
                  <button disabled>Tester les réglages enregistrés</button>
                ) : (
                  <Link className="button-link" href="/simulator">
                    Tester les réglages enregistrés →
                  </Link>
                )}
                {dirty && (
                  <p className="field-note">
                    Enregistrez vos modifications avant de les tester.
                  </p>
                )}
              </div>
            )}
            <Toggle
              checked={form.agent_auto_reply}
              onChange={(v) => set("agent_auto_reply", v)}
              title="L’agent prépare automatiquement une réponse à chaque nouveau message"
              note="Désactivé : les messages arrivent dans les conversations, sans brouillon de l’agent."
            />
            <div className="field-row">
              <span className="field-label">Fenêtre d’envoi des relances</span>
              <div className="field-control">
                <div className="field-inline">
                  <input
                    aria-label="Relances : à partir de (heure)"
                    type="number"
                    min={0}
                    max={23}
                    value={form.follow_up_window_start_hour}
                    onChange={num("follow_up_window_start_hour")}
                  />
                  <input
                    aria-label="jusqu’à (heure)"
                    type="number"
                    min={1}
                    max={24}
                    value={form.follow_up_window_end_hour}
                    onChange={num("follow_up_window_end_hour")}
                  />
                </div>
                <p className="field-note">
                  Heure de début et de fin (heure locale).
                </p>
              </div>
            </div>
            <Field label="Relances maximum sans réponse">
              <input
                type="number"
                min={1}
                max={10}
                value={form.follow_up_max_per_silence}
                onChange={num("follow_up_max_per_silence")}
              />
            </Field>
            <Toggle
              checked={form.follow_up_weekdays_only}
              onChange={(v) => set("follow_up_weekdays_only", v)}
              title="Relances en semaine uniquement"
            />
          </Section>

          <Section region="Emails" hidden={active !== "emails"} label="Emails">
            <Field
              label="Mention de bas de message (désinscription)"
              note="Ajoutée à chaque email envoyé : le prospect peut répondre STOP."
            >
              <textarea
                value={form.email_footer}
                rows={2}
                onChange={(e) => set("email_footer", e.target.value)}
              />
            </Field>
            <Field
              label="Mention « message rédigé avec une IA »"
              note="Ajoutée à tout email rédigé par l’agent (AI Act, art. 50). Vous pouvez adapter la formulation, pas la supprimer."
            >
              <textarea
                value={form.email_ai_notice}
                rows={2}
                minLength={10}
                maxLength={500}
                onChange={(e) => set("email_ai_notice", e.target.value)}
              />
            </Field>
            <Field
              label="Nom affiché en tête d’email"
              note="Remplacé par le logo s’il est renseigné."
            >
              <input
                value={form.email_brand_name}
                maxLength={80}
                onChange={(e) => set("email_brand_name", e.target.value)}
              />
            </Field>
            <Field
              label="Couleur principale des emails"
              note="Liseré, nom, liens et pastille IA."
            >
              <input
                type="color"
                value={form.email_brand_color}
                onChange={(e) => set("email_brand_color", e.target.value)}
              />
            </Field>
            <Field
              label="Logo (adresse https, facultatif)"
              note="Image publique hébergée par l’école, hauteur 36 px. Vide : le nom est affiché."
            >
              <input
                type="url"
                placeholder="https://…/logo.png"
                value={form.email_logo_url}
                onChange={(e) => set("email_logo_url", e.target.value)}
              />
            </Field>
            <div className="field-row">
              <span className="field-label">Aperçu</span>
              <div className="field-control">
                <div>
                  <button onClick={showPreview} disabled={busy !== null}>
                    Voir un exemple d’email
                  </button>
                </div>
                {preview && (
                  <iframe
                    className="email-preview"
                    title="Aperçu de l’email"
                    sandbox=""
                    srcDoc={preview}
                  />
                )}
                <p className="field-note">
                  Rendu par le même code que l’envoi, avec les réglages saisis
                  (non enregistrés).
                </p>
              </div>
            </div>
            <Field
              label="Relève de la boîte toutes les (secondes)"
              note="60 secondes conviennent ; la boîte se règle dans Intégrations."
            >
              <input
                type="number"
                min={10}
                max={3600}
                value={form.email_poll_seconds}
                onChange={num("email_poll_seconds")}
              />
            </Field>
            <Toggle
              checked={form.email_create_unknown_senders}
              onChange={(v) => set("email_create_unknown_senders", v)}
              title="Un expéditeur inconnu devient un prospect"
              note="Désactivé : seuls les emails de prospects déjà connus sont relevés."
            />
          </Section>

          <Section
            region="Disponibilités des rendez-vous"
            hidden={active !== "rdv"}
            label="Disponibilités des rendez-vous"
            intro="L’agent ne propose que des créneaux réellement libres dans l’agenda du conseiller, à l’intérieur de ces règles."
          >
            <div className="field-row">
              <span className="field-label">Jours ouvrés</span>
              <div className="field-control">
                <div
                  className="day-picker"
                  role="group"
                  aria-label="Jours ouvrés"
                >
                  {DAYS.map((d, i) => (
                    <label key={d}>
                      <input
                        type="checkbox"
                        checked={days.has(String(i + 1))}
                        onChange={() => toggleDay(i + 1)}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <Field label="Début de journée (heure)">
              <input
                type="number"
                min={0}
                max={23}
                value={form.calendar_work_start_hour}
                onChange={num("calendar_work_start_hour")}
              />
            </Field>
            <Field label="Fin de journée (heure)">
              <input
                type="number"
                min={1}
                max={24}
                value={form.calendar_work_end_hour}
                onChange={num("calendar_work_end_hour")}
              />
            </Field>
            <Field label="Durée d’un rendez-vous (minutes)">
              <input
                type="number"
                min={15}
                max={240}
                step={15}
                value={form.calendar_slot_minutes}
                onChange={num("calendar_slot_minutes")}
              />
            </Field>
            <Field
              label="Délai minimum avant un rendez-vous (heures)"
              note="Évite de proposer un créneau dans l’heure qui vient."
            >
              <input
                type="number"
                min={0}
                max={240}
                value={form.calendar_min_notice_hours}
                onChange={num("calendar_min_notice_hours")}
              />
            </Field>
            <Field label="Créneaux proposés sur (jours)">
              <input
                type="number"
                min={1}
                max={60}
                value={form.calendar_horizon_days}
                onChange={num("calendar_horizon_days")}
              />
            </Field>
            <Field label="Marge entre rendez-vous (minutes)">
              <input
                type="number"
                min={0}
                max={120}
                value={form.calendar_buffer_minutes}
                onChange={num("calendar_buffer_minutes")}
              />
            </Field>
            <Field label="Fuseau horaire" note="Ex. Europe/Paris.">
              <input
                value={form.calendar_timezone}
                onChange={(e) => set("calendar_timezone", e.target.value)}
              />
            </Field>
          </Section>

          <div className="actions-bar sticky">
            <button className="primary" onClick={save} disabled={busy !== null}>
              Enregistrer les paramètres
            </button>
            {form.source === "console" && (
              <button onClick={reset} disabled={busy !== null}>
                Revenir aux valeurs du serveur
              </button>
            )}
            {dirty && (
              <span className="status-text">
                Modifications non enregistrées
              </span>
            )}
            <Feedback notice={notice} error={error} />
          </div>
        </div>
      </div>
    </>
  );
}
