// Noms lisibles des champs envoyés à l'API, pour les erreurs de validation (422) des formulaires.
// Un champ absent de cette liste n'est jamais montré sous son nom technique : le message reste générique.

export const FIELD_LABELS: Record<string, string> = {
  // Prospects, leads et import
  first_name: "Prénom",
  last_name: "Nom",
  email: "Adresse email",
  phone: "Téléphone",
  message: "Message",
  profile: "Profil",
  consent: "Consentement",
  consent_granted: "Consentement",
  consent_source: "Origine du consentement",
  target_code: "Programme visé",
  target_codes: "Programmes visés",
  campaign_id: "Campagne",
  source_id: "Source",
  form_id: "Formulaire",
  form_name: "Nom du formulaire",
  file: "Fichier",
  facebook_id: "Identifiant Facebook",
  instagram_id: "Identifiant Instagram",
  linkedin_id: "Identifiant LinkedIn",
  keep_prospect_id: "Fiche à conserver",
  reason: "Motif",
  note: "Note",
  notes: "Notes",
  evidence_reference: "Référence du justificatif",
  evidence_type: "Type de justificatif",
  assigned_advisor_id: "Conseiller",
  advisor_id: "Conseiller",
  conversion_stage: "Étape",
  confirm: "Confirmation",

  // Campagnes
  name: "Nom",
  description: "Description",
  status: "Statut",
  start_date: "Date de début",
  end_date: "Date de fin",
  email_subject: "Objet de l’email",
  sources: "Sources",
  platform: "Plateforme",
  resources: "Ressources",
  label: "Libellé",
  url: "Adresse du lien",
  usage: "Usage",
  existing_prospects: "Prospects existants",

  // Conversations et brouillons
  content: "Contenu",
  summary: "Résumé",
  channel: "Canal",

  // Comptes et équipe
  username: "Nom d’utilisateur",
  password: "Mot de passe",
  current_password: "Mot de passe actuel",
  new_password: "Nouveau mot de passe",
  role: "Rôle",
  is_active: "Compte actif",

  // Messagerie
  address: "Adresse de la boîte",
  from_name: "Nom de l’expéditeur",
  imap_host: "Serveur IMAP",
  imap_port: "Port IMAP",
  imap_folder: "Dossier surveillé",
  smtp_host: "Serveur SMTP",
  smtp_port: "Port SMTP",
  smtp_security: "Sécurité SMTP",
  sandbox_recipients: "Destinataires de test",
  enabled: "Activation",
  send_enabled: "Envoi activé",

  // Agenda, Zoom, Meta
  provider: "Fournisseur",
  google_client_id: "Identifiant client Google",
  google_client_secret: "Secret client Google",
  default_user_id: "Agenda par défaut",
  account_id: "Identifiant de compte Zoom",
  client_id: "Identifiant client",
  client_secret: "Secret client",
  host_user: "Organisateur Zoom",
  mode: "Mode",
  app_id: "Identifiant de l’application",
  app_secret: "Secret de l’application",
  api_version: "Version de l’API",
  page_access_token: "Jeton d’accès de la page",
  verify_token: "Jeton de vérification",
  mappings: "Formulaires associés",

  // Paramètres (libellés de l'écran Paramètres)
  llm_provider: "Fournisseur",
  llm_model: "Modèle principal",
  llm_fallback_model: "Modèle de secours",
  llm_temperature: "Créativité",
  gemini_api_key: "Clé d’API Gemini",
  openai_api_key: "Clé d’API OpenAI",
  agent_auto_reply: "Réponse automatique",
  agent_min_confidence: "Confiance minimale de lecture",
  agent_meeting_min_score: "Score à partir duquel proposer un rendez-vous",
  agent_nurture_max_score: "Score jusqu’auquel un prospect est jugé froid",
  agent_extra_terms: "Termes à surveiller",
  calendar_timezone: "Fuseau horaire",
  calendar_work_days: "Jours ouvrés",
  calendar_work_start_hour: "Début de journée",
  calendar_work_end_hour: "Fin de journée",
  calendar_slot_minutes: "Durée d’un rendez-vous",
  calendar_buffer_minutes: "Marge entre rendez-vous",
  calendar_min_notice_hours: "Délai minimum avant un rendez-vous",
  calendar_horizon_days: "Créneaux proposés sur (jours)",
  follow_up_max_per_silence: "Relances maximum sans réponse",
  follow_up_window_start_hour: "Relances : à partir de",
  follow_up_window_end_hour: "Relances : jusqu’à",
  follow_up_weekdays_only: "Relances en semaine seulement",
  email_poll_seconds: "Relève de la boîte",
  email_brand_name: "Nom affiché en tête d’email",
  email_brand_color: "Couleur principale des emails",
  email_logo_url: "Logo",
  email_header_image_url: "Bandeau hébergé",
  email_header_tagline: "Phrase d’accroche du bandeau",
  email_footer: "Mention de bas de message",
  email_ai_notice: "Mention IA",
  email_signature_team: "Signature : équipe",
  email_signature_org: "Signature : établissement",
  email_postal_address: "Signature : adresse",
  email_contact_email: "Signature : email de contact",
  email_social_links: "Liens du pied d’email",

  // Évaluation
  min_score: "Score minimum",
  passes: "Nombre de passages",
  price_in: "Prix en entrée",
  price_out: "Prix en sortie",
};

/** Nom lisible du champ en cause : dernier élément nommé de `loc` (les index de liste sont ignorés). */
export function fieldLabel(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  for (let i = loc.length - 1; i >= 0; i--) {
    const part = loc[i];
    if (typeof part !== "string") continue;
    return Object.hasOwn(FIELD_LABELS, part) ? FIELD_LABELS[part] : null;
  }
  return null;
}
