"use client";

import type { ChangeEvent } from "react";
import { FlaskConical, Mail, Sparkles } from "lucide-react";
import { Btn, ColorChoice, ErrorText, FilterChip, LinkButton, Notice, SelectBox, TextBox, TextInput } from "@/components/ds/controls";
import { ActionsBar, InfoRow, SettingRow as Field, SettingsCard, Toggle } from "@/components/ds/settings";
import type { RuntimeSettings } from "@/lib/types";

/** Sections de l'écran Paramètres (une carte par catégorie). L'état du formulaire reste dans la page :
 *  une catégorie masquée garde sa saisie, et un seul bouton enregistre tout (règle 31). */
export type SectionProps = {
  form: RuntimeSettings;
  set: <K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]) => void;
  num: (key: keyof RuntimeSettings) => (e: ChangeEvent<HTMLInputElement>) => void;
  busy: string | null;
  hidden: boolean;
};

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function AiSection({
  form,
  set,
  num,
  busy,
  hidden,
  geminiKey,
  openaiKey,
  setGeminiKey,
  setOpenaiKey,
  setDirty,
  runTest,
  test,
}: SectionProps & {
  geminiKey: string;
  openaiKey: string;
  setGeminiKey: (value: string) => void;
  setOpenaiKey: (value: string) => void;
  setDirty: (dirty: boolean) => void;
  runTest: () => void;
  test: { ok: boolean; model: string; detail: string } | null;
}) {
  const gemini = form.llm_provider === "gemini";
  const keySet = gemini ? form.gemini_api_key_set : form.openai_api_key_set;
  return (
        <SettingsCard
          region="Intelligence artificielle"
          hidden={hidden}
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
  );
}

export function AgentSection({
  form,
  set,
  num,
  busy,
  hidden,
  dirty,
  canSimulate,
}: SectionProps & { dirty: boolean; canSimulate: boolean }) {
  return (
        <SettingsCard
          region="Agent et relances"
          hidden={hidden}
          label="Paramètres"
          title="Agent et relances"
          intro="Chaque relance reste un brouillon soumis à validation en mode assisté ; elles s’arrêtent dès que le prospect répond, se désinscrit ou est transféré."
        >
          {canSimulate && (
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
  );
}

export function EmailsSection({
  form,
  set,
  num,
  busy,
  hidden,
  preview,
  showPreview,
}: SectionProps & { preview: string | null; showPreview: () => void }) {
  return (
        <SettingsCard region="Emails" hidden={hidden} label="Paramètres" title="Emails">
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
  );
}

export function AppointmentsSection({ form, set, num, hidden }: SectionProps) {
  const days = new Set(form.calendar_work_days.split(",").filter(Boolean));
  const toggleDay = (d: number) => {
    const next = new Set(days);
    if (next.has(String(d))) next.delete(String(d));
    else next.add(String(d));
    set("calendar_work_days", [...next].sort().join(",") || form.calendar_work_days);
  };
  return (
        <SettingsCard
          region="Disponibilités des rendez-vous"
          hidden={hidden}
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
  );
}
