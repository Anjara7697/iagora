// Libellés français des valeurs techniques de l'API.

export const STAGES: Record<string, string> = {
  new: "Nouveau",
  to_qualify: "À qualifier",
  contacted: "Contacté",
  in_conversation: "En conversation",
  qualified: "Qualifié",
  meeting_proposed: "RDV proposé",
  meeting_scheduled: "RDV planifié",
  meeting_done: "RDV effectué",
  applied: "Candidature déposée",
  converted: "Converti",
  to_follow_up: "À relancer",
  lost: "Perdu",
};

export const LEVELS: Record<string, string> = {
  cold: "Froid",
  warm: "Tiède",
  hot: "Chaud",
  very_hot: "Très chaud",
};

export const ACTIONS: Record<string, string> = {
  continue_conversation: "Poursuivre l'échange",
  propose_meeting: "Proposer un rendez-vous",
  book_meeting: "Réserver le rendez-vous",
  human_handoff: "Transférer à un conseiller",
  nurture: "Entretenir (relance)",
  opt_out: "Désinscription",
  close: "Clôturer",
};

export const HANDOFF_REASONS: Record<string, string> = {
  candidature_a_verifier: "Candidature à vérifier",
  question_hors_base: "Question hors base de connaissances",
  situation_sensible: "Situation sensible",
  demande_conseiller: "Le prospect demande un conseiller",
  llm_indisponible: "Modèle de langage indisponible",
  reponse_non_verifiable: "Réponse non vérifiable",
  agenda_indisponible: "Agenda indisponible",
  agenda_non_configure: "Rendez-vous à planifier (agenda non branché)",
  aucun_creneau: "Aucun créneau disponible",
  reservation_impossible: "Réservation impossible",
  incertitude: "Incertitude du modèle",
};

export const CONSENT: Record<string, string> = {
  unknown: "Inconnu",
  granted: "Accordé",
  opted_out: "Désinscrit",
};

export const ROLES: Record<string, string> = {
  prospect: "Prospect",
  agent: "Agent",
  advisor: "Conseiller",
};

export const label = (
  map: Record<string, string>,
  key: string | null | undefined,
): string => (key ? (map[key] ?? key) : "-");

export function fullName(p: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}): string {
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
  return name || p.email || "(anonyme)";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export const CONVERSATION_STATUS: Record<string, string> = {
  open: "Ouverte",
  handed_off: "En attente d'un conseiller",
  closed: "Clôturée",
};

export const CHANNELS: Record<string, string> = {
  email: "Email",
  facebook: "Messenger",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

/** « il y a 2 h », « il y a 3 j » ; au-delà d'une semaine, la date. */
export function relativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return "-";
  const minutes = Math.max(
    0,
    Math.round((now - new Date(iso).getTime()) / 60000),
  );
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 8) return `il y a ${days} j`;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export const TODO_KINDS: Record<string, string> = {
  validation: "Validation requise",
  escalation: "Escalade",
  kb_gap: "Lacune KB",
  incident: "Incident",
};

export const PRIORITIES: Record<string, string> = {
  critical: "Critique",
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
};

export const RISKS: Record<string, string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
};

export const DRAFT_STATUS: Record<string, string> = {
  pending: "Brouillon en attente de validation",
  approved: "Validé",
  rejected: "Refusé",
  superseded: "Remplacé par une nouvelle version",
  cancelled: "Annulé (désinscription)",
};

export const DELIVERY: Record<string, string> = {
  simulated: "Reçu dans la boîte fictive",
  not_sent: "Prêt à envoyer",
  sending: "Envoi en cours",
  sent: "Distribué",
  failed: "Échec d’envoi",
  blocked: "Envoi bloqué",
};

export const TARGETS: Record<string, string> = {
  ebihar_students: "eBIHAR — étudiants",
  compagnons_pros: "Les Compagnons — professionnels",
  master_candidates: "Master eBIHAR — candidats",
  master_companies: "Master eBIHAR — entreprises",
};

export const CAMPAIGN_STATUS: Record<string, string> = {
  draft: "Brouillon",
  active: "Active",
  inactive: "Inactive",
};

export const SOURCE_TYPES: Record<string, string> = {
  ads: "Publicité",
  form: "Formulaire",
  landing_page: "Page d'atterrissage",
  webinar: "Webinaire",
  import: "Import",
};

export const PLATFORMS: Record<string, string> = {
  linkedin: "LinkedIn",
  meta: "Meta",
  web: "Site web",
  email: "Email",
};

/** Étapes regroupées pour l'entonnoir d'une campagne. */
export const FUNNEL: { title: string; stages: string[] }[] = [
  { title: "À qualifier", stages: ["new", "to_qualify"] },
  { title: "En échange", stages: ["contacted", "in_conversation"] },
  { title: "Qualifiés", stages: ["qualified"] },
  {
    title: "Rendez-vous",
    stages: ["meeting_proposed", "meeting_scheduled", "meeting_done"],
  },
  { title: "Candidature", stages: ["applied"] },
  { title: "Convertis", stages: ["converted"] },
  { title: "À relancer", stages: ["to_follow_up"] },
  { title: "Perdus", stages: ["lost"] },
];

export function formatDay(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "-";
}

/** Titre de l'en-tête selon la route (les plus spécifiques d'abord). */
const PAGE_TITLES: [string, string][] = [
  ["/appointments", "Rendez-vous"],
  ["/campaigns/new", "Nouvelle campagne"],
  ["/campaigns/", "Campagne"],
  ["/campaigns", "Campagnes"],
  ["/prospects/import", "Import de prospects"],
  ["/prospects/", "Fiche prospect"],
  ["/prospects", "Prospects"],
  ["/conversations", "Conversations"],
  ["/todo", "À traiter"],
  ["/knowledge", "Base de connaissances"],
  ["/integrations", "Intégrations"],
  ["/team", "Équipe"],
  ["/settings/testing", "Tests et démonstration"],
  ["/settings", "Paramètres"],
  ["/account", "Mon compte"],
  ["/simulator", "Simulateur"],
];

export function pageTitle(pathname: string): string {
  if (pathname === "/") return "Aujourd’hui";
  return (
    PAGE_TITLES.find(
      ([prefix]) => pathname === prefix || pathname.startsWith(prefix),
    )?.[1] ?? "IAGORA"
  );
}

/** Prospect fictif (simulateur, démonstration) : adresse réservée, jamais contactée pour de vrai. */
export const isDemoEmail = (email: string | null | undefined): boolean =>
  !!email && email.trim().toLowerCase().endsWith("@demo.example.com");

/** Champs du profil collectés par l'agent (F-09), en français. */
export const PROFILE_FIELDS: Record<string, string> = {
  education_level: "Niveau d’études",
  objective: "Objectif",
  study_level: "Niveau d’études",
  field_of_study: "Domaine d’études",
  goal: "Projet",
  availability: "Disponibilité",
  budget: "Budget",
  city: "Ville",
  profession: "Profession",
  company: "Entreprise",
  experience: "Expérience",
};

const PAGE_SUBTITLES: [string, string][] = [
  ["/appointments", "À venir et passés"],
  ["/campaigns/new", "Segments, sources et statuts"],
  ["/campaigns", "Segments, sources et statuts"],
  ["/prospects/", "Parcours, échanges et décisions de l’agent"],
  ["/prospects", "Pipeline et table"],
  ["/conversations", "Inbox unifiée"],
  ["/todo", "Réponses à valider et demandes de conseiller"],
  ["/knowledge", "Connaissances de l’agent"],
  ["/integrations", "Canaux et synchronisation"],
  ["/team", "Membres, rôles et accès"],
  ["/settings/testing", "Essais de l’agent avec des données fictives"],
  ["/settings", "IA, relances, emails et rendez-vous"],
  ["/account", "Profil et mot de passe"],
  ["/simulator", "Tests et démonstration"],
];

export function pageSubtitle(pathname: string): string {
  if (pathname === "/")
    return new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  return (
    PAGE_SUBTITLES.find(
      ([prefix]) => pathname === prefix || pathname.startsWith(prefix),
    )?.[1] ?? ""
  );
}

/** État d'exécution d'un brouillon décidé : lisible après traitement. */
export const EXECUTION: Record<string, string> = {
  pending: "À valider",
  approved: "Approuvée, prête à envoyer",
  sending: "Envoi en cours",
  sent: "Envoyée",
  failed: "Échec d’envoi",
  blocked: "Envoi bloqué",
  rejected: "Refusée",
};

export const APPOINTMENT_STATUS: Record<string, string> = {
  proposed: "Proposé", scheduled: "Planifié", done: "Réalisé", cancelled: "Annulé", no_show: "Absent",
};
