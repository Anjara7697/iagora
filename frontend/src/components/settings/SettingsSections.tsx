"use client";

import { FlaskConical, Mail, Sparkles } from "lucide-react";
import { Btn, ColorChoice, ErrorText, FilterChip, LinkButton, Notice, NumberInput, SelectBox, TextBox, TextInput } from "@/components/ds/controls";
import { ActionsBar, InfoRow, SettingRow as Field, SettingsCard, Toggle } from "@/components/ds/settings";
import EmailBanner from "@/components/settings/EmailBanner";
import type { RuntimeSettings } from "@/lib/types";

/** Sections de l'écran Paramètres (une carte par catégorie). L'état du formulaire reste dans la page :
 *  une catégorie masquée garde sa saisie, et un seul bouton enregistre tout (règle 31). */
/** Réglages numériques (bornés dans le formulaire par `NumberInput`). */
export type NumericSetting = { [K in keyof RuntimeSettings]-?: RuntimeSettings[K] extends number ? K : never }[keyof RuntimeSettings];

type SectionProps = {
  form: RuntimeSettings;
  set: <K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]) => void;
  /** Champ numérique du formulaire : valeur et mise à jour pour `NumberInput`. */
  num: (key: NumericSetting) => { value: number; onValueChange: (value: number) => void };
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
            <SelectBox
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
            <TextInput
              value={form.llm_model}
              onChange={(e) => set("llm_model", e.target.value)}
            />
          </Field>
          <Field
            label="Modèle de secours (si le principal est saturé)"
            note="Même fournisseur et même clé, ex. gemini-2.5-flash-lite. Vide : aucun secours."
          >
            <TextInput
              value={form.llm_fallback_model}
              placeholder="gemini-2.5-flash-lite"
              onChange={(e) => set("llm_fallback_model", e.target.value)}
            />
          </Field>
          <Field
            label={`Clé d’API ${gemini ? "Gemini" : "OpenAI"}`}
            note="Chiffrée sur le serveur, jamais réaffichée. Laisser vide pour conserver la clé actuelle."
          >
            <TextInput
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
            <NumberInput
              step={0.1}
              min={0}
              max={2}
              {...num("llm_temperature")}
            />
          </Field>
          <InfoRow
            label="Recherche documentaire"
            note="Réglé sur le serveur : en changer impose de recalculer la base de connaissances."
          >
            <span className="font-mono type-body-sm">{form.embedding_model}</span>
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
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-secondary px-4 py-3">
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
                <p className="type-caption text-muted">
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
                <div className="flex flex-col gap-1">
                  <NumberInput
                    aria-label="Relances : à partir de (heure)"
                    min={0}
                    max={23}
                    className="w-24"
                    fullWidth={false}
                    {...num("follow_up_window_start_hour")}
                  />
                </div>
                <span className="type-body text-muted">→</span>
                <div className="flex flex-col gap-1">
                  <NumberInput
                    aria-label="jusqu’à (heure)"
                    min={1}
                    max={24}
                    className="w-24"
                    fullWidth={false}
                    {...num("follow_up_window_end_hour")}
                  />
                </div>
              </div>
          </InfoRow>
          <Field label="Relances maximum sans réponse">
            <NumberInput
              min={1}
              max={10}
              {...num("follow_up_max_per_silence")}
            />
          </Field>
          <Toggle
            checked={form.follow_up_weekdays_only}
            onChange={(v) => set("follow_up_weekdays_only", v)}
            title="Relances en semaine uniquement"
          />
          <Toggle
            checked={form.advisor_alerts_enabled}
            onChange={(v) => set("advisor_alerts_enabled", v)}
            title="Alertes des conseillers par email"
            note="Urgences tout de suite (situation sensible, données personnelles, prospect très chaud), le reste dans un récapitulatif chaque jour ouvré. Elles partent par la boîte email de l’agent, si son envoi est activé ; chacun peut couper les siennes dans Mon compte."
          />
          <Field label="Heure du récapitulatif (fuseau de l’agenda)">
            <NumberInput
              min={0}
              max={23}
              disabled={!form.advisor_alerts_enabled}
              {...num("advisor_alerts_digest_hour")}
            />
          </Field>
          <Field
            label="Adresse de la console"
            note="Pour les liens des alertes vers la fiche du prospect, par exemple https://console.datum.fr. Vide : alertes sans lien."
          >
            <TextInput
              type="url"
              maxLength={300}
              placeholder="https://"
              value={form.console_url}
              onChange={(e) => set("console_url", e.target.value)}
            />
          </Field>
          <InfoRow
            label="Seuils de décision de l’agent"
            note="Valeurs du cahier des charges par défaut (50, 24, 0,5), à confirmer avec DATUM. Les règles restent les mêmes : seuls les seuils changent."
          />
          <Field
            label="Score à partir duquel proposer un rendez-vous"
            note="Prospect qualifié (profil complet) dont le score atteint ce seuil : l’agent propose des créneaux réels."
          >
            <NumberInput
              min={1}
              max={100}
              {...num("agent_meeting_min_score")}
            />
          </Field>
          <Field
            label="Score jusqu’auquel un prospect est jugé froid"
            note="En dessous, un message neutre est suivi d’un entretien espacé, sans insister. Doit rester sous le seuil de rendez-vous."
          >
            <NumberInput
              min={0}
              max={99}
              {...num("agent_nurture_max_score")}
            />
          </Field>
          <Field
            label="Confiance minimale de lecture (0,1 à 0,95)"
            note="Si le modèle comprend le message avec moins de confiance, la conversation passe à un conseiller."
          >
            <NumberInput
              step={0.05}
              min={0.1}
              max={0.95}
              {...num("agent_min_confidence")}
            />
          </Field>
          <Field
            label="Termes qui engagent l’école (en plus de la liste intégrée)"
            note="Séparés par des virgules. Une réponse qui les cite sans document validé est bloquée, comme CPF, RNCP ou « éligible »."
          >
            <TextBox
              rows={2}
              maxLength={1000}
              placeholder="Pass Transition, prise en charge totale"
              value={form.agent_extra_terms}
              onChange={(e) => set("agent_extra_terms", e.target.value)}
            />
          </Field>
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
            <TextBox
              value={form.email_footer}
              rows={2}
              onChange={(e) => set("email_footer", e.target.value)}
            />
          </Field>
          <Field
            label="Mention IA, message relu par un conseiller"
            note="Ajoutée à tout email rédigé par l’agent puis validé par un conseiller (AI Act, art. 50) : c’est le cas normal. Vous pouvez adapter la formulation, pas la supprimer."
          >
            <TextBox
              value={form.email_ai_notice_reviewed}
              rows={2}
              minLength={10}
              maxLength={500}
              onChange={(e) => set("email_ai_notice_reviewed", e.target.value)}
            />
          </Field>
          <Field
            label="Mention IA, message envoyé sans relecture"
            note="Ajoutée à un email parti sans validation (mode automatique, refusé en production pendant le pilote). Vous pouvez adapter la formulation, pas la supprimer."
          >
            <TextBox
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
            <TextInput
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
            <TextInput
              type="url"
              placeholder="https://…/logo.png"
              value={form.email_logo_url}
              onChange={(e) => set("email_logo_url", e.target.value)}
            />
          </Field>
          <InfoRow
            label="Bandeau chargé"
            note="Recommandé : l’image est intégrée à chaque email, sans hébergement, et s’affiche même quand les images distantes sont bloquées. Elle remplace le bandeau hébergé et le bandeau dessiné."
          >
            <EmailBanner />
          </InfoRow>
          <Field
            label="Bandeau hébergé (image https, facultatif)"
            note="Sans bandeau chargé : image publique de 600 px de large, hébergée par l’école. Vide : un bandeau aux couleurs de l’école, avec le nom (ou le logo) et la phrase d’accroche."
          >
            <TextInput
              type="url"
              placeholder="https://…/bandeau.png"
              value={form.email_header_image_url}
              onChange={(e) => set("email_header_image_url", e.target.value)}
            />
          </Field>
          <Field label="Phrase d’accroche du bandeau" note="ex. « Nous ouvrons la voie aux leaders IT de demain ».">
            <TextInput
              value={form.email_header_tagline}
              maxLength={160}
              onChange={(e) => set("email_header_tagline", e.target.value)}
            />
          </Field>
          <Field label="Signature : équipe" note="En gras sous chaque email, ex. « L’équipe admissions ».">
            <TextInput
              value={form.email_signature_team}
              maxLength={80}
              onChange={(e) => set("email_signature_team", e.target.value)}
            />
          </Field>
          <Field label="Signature : établissement">
            <TextInput
              value={form.email_signature_org}
              maxLength={80}
              onChange={(e) => set("email_signature_org", e.target.value)}
            />
          </Field>
          <Field label="Signature : email de contact">
            <TextInput
              type="email"
              value={form.email_contact_email}
              maxLength={120}
              onChange={(e) => set("email_contact_email", e.target.value)}
            />
          </Field>
          <Field label="Signature : adresse" note="Une ligne par ligne d’adresse.">
            <TextBox
              value={form.email_postal_address}
              rows={2}
              maxLength={300}
              onChange={(e) => set("email_postal_address", e.target.value)}
            />
          </Field>
          <Field
            label="Liens du pied d’email"
            note="Un lien par ligne : « Libellé | https://… », ex. « LinkedIn | https://www.linkedin.com/company/… »."
          >
            <TextBox
              value={form.email_social_links}
              rows={4}
              maxLength={1000}
              onChange={(e) => set("email_social_links", e.target.value)}
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
                className="email-preview h-[420px] w-full rounded-lg border border-separator bg-white"
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
            <NumberInput
              min={10}
              max={3600}
              {...num("email_poll_seconds")}
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
            <NumberInput
              min={0}
              max={23}
              {...num("calendar_work_start_hour")}
            />
          </Field>
          <Field label="Fin de journée (heure)">
            <NumberInput
              min={1}
              max={24}
              {...num("calendar_work_end_hour")}
            />
          </Field>
          <Field label="Durée d’un rendez-vous (minutes)">
            <NumberInput
              min={15}
              max={240}
              step={15}
              {...num("calendar_slot_minutes")}
            />
          </Field>
          <Field
            label="Délai minimum avant un rendez-vous (heures)"
            note="Évite de proposer un créneau dans l’heure qui vient."
          >
            <NumberInput
              min={0}
              max={240}
              {...num("calendar_min_notice_hours")}
            />
          </Field>
          <Field label="Créneaux proposés sur (jours)">
            <NumberInput
              min={1}
              max={60}
              {...num("calendar_horizon_days")}
            />
          </Field>
          <Field label="Marge entre rendez-vous (minutes)">
            <NumberInput
              min={0}
              max={120}
              {...num("calendar_buffer_minutes")}
            />
          </Field>
          <Field label="Fuseau horaire" note="Ex. Europe/Paris.">
            <TextInput
              value={form.calendar_timezone}
              onChange={(e) => set("calendar_timezone", e.target.value)}
            />
          </Field>
        </SettingsCard>
  );
}
