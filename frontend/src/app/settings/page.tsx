"use client";

import { toast } from "@heroui/react";
import { Bot, CalendarClock, Mail, Sparkles, FlaskConical, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TestingAccess from "@/components/TestingAccess";
import { canUseSimulator } from "@/lib/access";
import { Suspense, useEffect, useState } from "react";
import { useCurrentUser } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ds/ConfirmDialog";
import { Btn, ColorChoice, ErrorText, FilterChip, LinkButton, Notice, SelectBox, TextBox, TextInput } from "@/components/ds/controls";
import { ErrorState, PageHeader, Screen, cx } from "@/components/ds/layout";
import { reveal } from "@/components/ds/motion";
import { Skeleton } from "@/components/ui";
import { useDiscardGuard } from "@/components/ds/useDiscardGuard";
import { ActionsBar, InfoRow, SettingRow as Field, SettingsCard, Toggle } from "@/components/ds/settings";
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
const ICONS: Record<string, LucideIcon> = { ia: Sparkles, agent: Bot, emails: Mail, rdv: CalendarClock };
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Quitter Paramètres (menu, onglet) avec des réglages non enregistrés demande confirmation.
  const { dialog: discardDialog } = useDiscardGuard(() => dirty);
  const [preview, setPreview] = useState<string | null>(null);
  const [test, setTest] = useState<{
    ok: boolean;
    model: string;
    detail: string;
  } | null>(null);
  const isAdmin = user?.role === "ADMIN";

  const load = () => {
    setLoadError(null);
    return api<RuntimeSettings>("/settings")
      .then((s) => {
        setForm(s);
        setDirty(false);
      })
      .catch((e) =>
        setLoadError(`Chargement des paramètres impossible${e instanceof ApiError ? ` : ${e.message}` : "."}`),
      );
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (user && !isAdmin)
    return canUseSimulator(user.role) ? (
      <Screen className="max-w-[960px]">
        <PageHeader
          eyebrow="Réglages · Outils de test"
          title="Paramètres"
          subtitle="Retrouvez les outils pour essayer l’agent avec des données fictives."
        />
        <TestingAccess />
      </Screen>
    ) : (
      <Screen>
        <Notice tone="warning">Cette page est réservée aux administrateurs.</Notice>
      </Screen>
    );
  if (!form)
    return (
      <Screen className="max-w-[1200px]">
        <PageHeader eyebrow="Administration · Paramètres" title="Paramètres" />
        <TestingAccess />
        {loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : <Skeleton />}
      </Screen>
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

  /** `failure` dit ce qui a échoué, avant le détail du serveur (règle 12). */
  async function act(name: string, failure: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(`${failure}${e instanceof ApiError ? ` : ${e.message}` : "."}`);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    act("save", "Enregistrement impossible", async () => {
      await api("/settings", { method: "PUT", body: payload() });
      setGeminiKey("");
      setOpenaiKey("");
      await load();
      toast.success("Paramètres enregistrés", { description: "Ils s’appliquent immédiatement, sans redémarrage." });
    });
  const runTest = () =>
    act("test", "Test du modèle impossible", async () => {
      setTest(null);
      setTest(
        await api("/settings/llm/test", { method: "POST", body: payload() }),
      );
    });
  const showPreview = () =>
    act("preview", "Aperçu impossible", async () => {
      const r = await api<{ html: string }>("/settings/email/preview", {
        method: "POST",
        body: payload(),
      });
      setPreview(r.html);
    });
  const reset = () =>
    act("reset", "Retour aux valeurs du serveur impossible", async () => {
      await api("/settings", { method: "DELETE" });
      setGeminiKey("");
      setOpenaiKey("");
      await load();
      toast.success("Valeurs du serveur rétablies", { description: "Les réglages enregistrés dans la console sont oubliés." });
    });

  const gemini = form.llm_provider === "gemini";
  const keySet = gemini ? form.gemini_api_key_set : form.openai_api_key_set;

  return (
    <Screen className="max-w-[1200px]">
      {discardDialog}
      <PageHeader
        {...reveal(0)}
        eyebrow="Administration · Paramètres"
        title="Paramètres"
        subtitle={
          <>
            Réglages de l’agent, appliqués sans redémarrage.{" "}
            {form.source === "console"
              ? "Enregistrés dans la console."
              : "Valeurs par défaut du serveur : enregistrer ici les remplace."}
          </>
        }
      />

      <div
        className={cx("grid grid-cols-1 items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]", reveal(1).className)}
        style={reveal(1).style}
      >
        <div className="flex flex-col gap-1.5 lg:hidden">
          <label id="settings-category-label" htmlFor="settings-category" className="text-[13px] font-medium text-foreground">
            Catégorie
          </label>
          <SelectBox variant="secondary"
            id="settings-category"
            aria-labelledby="settings-category-label"
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
          </SelectBox>
        </div>
        <nav className="hidden flex-col gap-1 lg:sticky lg:top-24 lg:flex" aria-label="Catégories de paramètres">
          {SECTIONS.map((s) => {
            const Icon = ICONS[s.id];
            const on = active === s.id;
            return (
              <Link
                key={s.id}
                href={`${pathname}?section=${s.id}`}
                replace
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus",
                  on ? "bg-surface shadow-surface" : "hover:bg-default/60",
                )}
              >
                <Icon className={cx("mt-0.5 size-4 shrink-0", on ? "text-accent" : "text-muted")} aria-hidden="true" />
                <span className="flex flex-col">
                  <span className={cx("text-sm font-medium", on ? "text-foreground" : "text-foreground/90")}>{s.label}</span>
                  <small className="text-xs text-muted">{s.hint}</small>
                </span>
              </Link>
            );
          })}
          <div className="my-2 border-t border-separator" />
          <TestingAccess compact disabled={busy !== null} unsaved={dirty} />
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <SettingsCard
            region="Intelligence artificielle"
            hidden={active !== "ia"}
            label="Paramètres"
            title="Intelligence artificielle"
            intro="Le modèle rédige les réponses et lit les messages. Si le modèle principal reste indisponible (surcharge, quota) après ses nouveaux essais, la même demande part sur le modèle de secours avant tout transfert au conseiller."
          >
            <Field label="Fournisseur">
              <SelectBox variant="secondary"
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
              </SelectBox>
            </Field>
            <Field label="Modèle principal" note="Ex. gemini-2.5-flash.">
              <TextInput variant="secondary"
                value={form.llm_model}
                onChange={(e) => set("llm_model", e.target.value)}
              />
            </Field>
            <Field
              label="Modèle de secours (si le principal est saturé)"
              note="Même fournisseur et même clé, ex. gemini-2.5-flash-lite. Vide : aucun secours."
            >
              <TextInput variant="secondary"
                value={form.llm_fallback_model}
                placeholder="gemini-2.5-flash-lite"
                onChange={(e) => set("llm_fallback_model", e.target.value)}
              />
            </Field>
            <Field
              label={`Clé d’API ${gemini ? "Gemini" : "OpenAI"}`}
              note="Chiffrée sur le serveur, jamais réaffichée. Laisser vide pour conserver la clé actuelle."
            >
              <TextInput variant="secondary"
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
              <TextInput variant="secondary"
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={form.llm_temperature}
                onChange={num("llm_temperature")}
              />
            </Field>
            <InfoRow
              label="Recherche documentaire"
              note="Réglé sur le serveur : en changer impose de recalculer la base de connaissances."
            >
              <span className="font-mono text-[13px]">{form.embedding_model}</span>
            </InfoRow>
            <ActionsBar className="border-t border-separator pt-4">
              <Btn variant="outline" onClick={runTest} disabled={busy !== null}>
                <Sparkles className="size-4" aria-hidden="true" />
                {busy === "test" ? "Test en cours…" : "Tester le modèle"}
              </Btn>
            </ActionsBar>
            {test &&
              (test.ok ? (
                <Notice aria-label="Résultat du test du modèle">{`${test.model} répond (« ${test.detail} »)`}</Notice>
              ) : (
                <ErrorText aria-label="Résultat du test du modèle">{`Le modèle ne répond pas : ${test.detail}`}</ErrorText>
              ))}
          </SettingsCard>

          <SettingsCard
            region="Agent et relances"
            hidden={active !== "agent"}
            label="Paramètres"
            title="Agent et relances"
            intro="Chaque relance reste un brouillon soumis à validation en mode assisté ; elles s’arrêtent dès que le prospect répond, se désinscrit ou est transféré."
          >
            {canUseSimulator(user?.role) && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-secondary px-4 py-3">
                {dirty || busy !== null ? (
                  <Btn size="sm" disabled>
                    Tester les réglages enregistrés
                  </Btn>
                ) : (
                  <LinkButton size="sm" variant="outline" href="/simulator">
                    <FlaskConical className="size-4" aria-hidden="true" />
                    Tester les réglages enregistrés →
                  </LinkButton>
                )}
                {dirty && (
                  <p className="text-xs text-muted">
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
            <InfoRow label="Fenêtre d’envoi des relances" note="Heure de début et de fin (heure locale).">
                <div className="flex items-center gap-2">
                  <TextInput variant="secondary"
                    aria-label="Relances : à partir de (heure)"
                    type="number"
                    min={0}
                    max={23}
                    value={form.follow_up_window_start_hour}
                    onChange={num("follow_up_window_start_hour")}
                    className="w-24"
                  />
                  <span className="text-sm text-muted">→</span>
                  <TextInput variant="secondary"
                    aria-label="jusqu’à (heure)"
                    type="number"
                    min={1}
                    max={24}
                    value={form.follow_up_window_end_hour}
                    onChange={num("follow_up_window_end_hour")}
                    className="w-24"
                  />
                </div>
            </InfoRow>
            <Field label="Relances maximum sans réponse">
              <TextInput variant="secondary"
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
          </SettingsCard>

          <SettingsCard region="Emails" hidden={active !== "emails"} label="Paramètres" title="Emails">
            <Field
              label="Mention de bas de message (désinscription)"
              note="Ajoutée à chaque email envoyé : le prospect peut répondre STOP."
            >
              <TextBox variant="secondary"
                value={form.email_footer}
                rows={2}
                onChange={(e) => set("email_footer", e.target.value)}
              />
            </Field>
            <Field
              label="Mention « message rédigé avec une IA »"
              note="Ajoutée à tout email rédigé par l’agent (AI Act, art. 50). Vous pouvez adapter la formulation, pas la supprimer."
            >
              <TextBox variant="secondary"
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
              <TextInput variant="secondary"
                value={form.email_brand_name}
                maxLength={80}
                onChange={(e) => set("email_brand_name", e.target.value)}
              />
            </Field>
            <InfoRow label="Couleur principale des emails" note="Liseré, nom, liens et pastille IA.">
              <ColorChoice
                label="Couleur principale des emails"
                value={form.email_brand_color}
                onChange={(hex) => set("email_brand_color", hex)}
              />
            </InfoRow>
            <Field
              label="Logo (adresse https, facultatif)"
              note="Image publique hébergée par l’école, hauteur 36 px. Vide : le nom est affiché."
            >
              <TextInput variant="secondary"
                type="url"
                placeholder="https://…/logo.png"
                value={form.email_logo_url}
                onChange={(e) => set("email_logo_url", e.target.value)}
              />
            </Field>
            <InfoRow
              label="Aperçu"
              note="Rendu par le même code que l’envoi, avec les réglages saisis (non enregistrés)."
            >
              <Btn size="sm" variant="outline" className="w-fit" onClick={showPreview} disabled={busy !== null}>
                <Mail className="size-4" aria-hidden="true" />
                Voir un exemple d’email
              </Btn>
              {preview && (
                <iframe
                  className="email-preview h-[420px] w-full rounded-xl border border-separator bg-white"
                  title="Aperçu de l’email"
                  sandbox=""
                  srcDoc={preview}
                />
              )}
            </InfoRow>
            <Field
              label="Relève de la boîte toutes les (secondes)"
              note="60 secondes conviennent ; la boîte se règle dans Intégrations."
            >
              <TextInput variant="secondary"
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
          </SettingsCard>

          <SettingsCard
            region="Disponibilités des rendez-vous"
            hidden={active !== "rdv"}
            label="Paramètres"
            title="Disponibilités des rendez-vous"
            intro="L’agent ne propose que des créneaux réellement libres dans l’agenda du conseiller, à l’intérieur de ces règles."
          >
            <InfoRow label="Jours ouvrés">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Jours ouvrés">
                {DAYS.map((d, i) => {
                  const on = days.has(String(i + 1));
                  return (
                    <FilterChip key={d} pressed={on} onClick={() => toggleDay(i + 1)}>
                      {d}
                    </FilterChip>
                  );
                })}
              </div>
            </InfoRow>
            <Field label="Début de journée (heure)">
              <TextInput variant="secondary"
                type="number"
                min={0}
                max={23}
                value={form.calendar_work_start_hour}
                onChange={num("calendar_work_start_hour")}
              />
            </Field>
            <Field label="Fin de journée (heure)">
              <TextInput variant="secondary"
                type="number"
                min={1}
                max={24}
                value={form.calendar_work_end_hour}
                onChange={num("calendar_work_end_hour")}
              />
            </Field>
            <Field label="Durée d’un rendez-vous (minutes)">
              <TextInput variant="secondary"
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
              <TextInput variant="secondary"
                type="number"
                min={0}
                max={240}
                value={form.calendar_min_notice_hours}
                onChange={num("calendar_min_notice_hours")}
              />
            </Field>
            <Field label="Créneaux proposés sur (jours)">
              <TextInput variant="secondary"
                type="number"
                min={1}
                max={60}
                value={form.calendar_horizon_days}
                onChange={num("calendar_horizon_days")}
              />
            </Field>
            <Field label="Marge entre rendez-vous (minutes)">
              <TextInput variant="secondary"
                type="number"
                min={0}
                max={120}
                value={form.calendar_buffer_minutes}
                onChange={num("calendar_buffer_minutes")}
              />
            </Field>
            <Field label="Fuseau horaire" note="Ex. Europe/Paris.">
              <TextInput variant="secondary"
                value={form.calendar_timezone}
                onChange={(e) => set("calendar_timezone", e.target.value)}
              />
            </Field>
          </SettingsCard>

          <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-2xl border border-separator bg-surface/95 px-4 py-3 shadow-overlay backdrop-blur">
            <ActionsBar>
              <Btn variant="primary" onClick={save} disabled={busy !== null}>
                Enregistrer les paramètres
              </Btn>
              {form.source === "console" && (
                <ConfirmDialog
                  trigger={
                    <Btn variant="ghost" disabled={busy !== null}>
                      Revenir aux valeurs du serveur
                    </Btn>
                  }
                  title="Revenir aux valeurs du serveur ?"
                  description="Les réglages enregistrés dans la console sont oubliés, clés d’API comprises : l’agent reprend les valeurs du fichier de configuration du serveur."
                  confirmLabel="Revenir aux valeurs du serveur"
                  status="warning"
                  onConfirm={() => void reset()}
                />
              )}
              {dirty && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-soft-foreground">
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                  Modifications non enregistrées
                </span>
              )}
            </ActionsBar>
            {error && <ErrorText>{error}</ErrorText>}
          </div>
        </div>
      </div>
    </Screen>
  );
}
