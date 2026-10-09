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
  question_hors_base: "Question hors base de connaissances",
  situation_sensible: "Situation sensible",
  demande_conseiller: "Le prospect demande un conseiller",
  llm_indisponible: "Modèle de langage indisponible",
  reponse_non_verifiable: "Réponse non vérifiable",
  agenda_indisponible: "Agenda indisponible",
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

export const label = (map: Record<string, string>, key: string | null | undefined): string =>
  key ? (map[key] ?? key) : "-";

export function fullName(p: { first_name: string | null; last_name: string | null; email: string | null }): string {
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
  return name || p.email || "(anonyme)";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}
