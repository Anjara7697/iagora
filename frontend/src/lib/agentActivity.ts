/**
 * Journal en direct de l'agent (ce qu'il fait à l'instant) : phrases affichées et rythme de relecture. Les étapes
 * viennent de libellés fixes du serveur ; aucun texte du modèle n'arrive jusqu'ici.
 */

import type { AgentActivity, AgentActivityState } from "@/lib/types";

type StateOnly = { state: AgentActivityState; waiting_reason?: AgentActivity["waiting_reason"] };

export const ACTIVE_POLL_MS = 2000;
export const IDLE_POLL_MS = 15000;

const BUSY: AgentActivityState[] = ["queued", "running", "retrying", "waiting", "stalled"];
/** L'agent travaille ou attend pour cette conversation. */
export const isBusy = (a: StateOnly | null | undefined) => !!a && BUSY.includes(a.state);

/** Relecture rapide seulement quand quelque chose va bouger bientôt (pas en mode manuel ni sans campagne). */
export function pollDelay(a: StateOnly | null | undefined): number {
  if (!a || !isBusy(a)) return IDLE_POLL_MS;
  if (a.state === "waiting" && a.waiting_reason !== "grouping") return IDLE_POLL_MS;
  if (a.state === "stalled") return IDLE_POLL_MS;
  return ACTIVE_POLL_MS;
}

/** Durée courte : « 8 s », « 1 min 40 », « 3 min ». */
export function shortDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes < 10 && rest ? `${minutes} min ${String(rest).padStart(2, "0")}` : `${minutes} min`;
}

const at = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Étape en cours, ou dernière étape faite. */
export function currentStep(a: AgentActivity) {
  return a.steps?.findLast((s) => s.status === "running") ?? null;
}

/** Phrase principale : ce que fait l'agent ou ce qu'il attend. */
export function activityTitle(a: AgentActivity, now: number = Date.now()): string {
  const next = at(a.next_attempt_at);
  switch (a.state) {
    case "running": {
      const step = currentStep(a);
      return step ? `L’agent travaille : ${step.label.toLowerCase()}` : "L’agent travaille";
    }
    case "queued":
      return "Message reçu : l’agent va le traiter";
    case "waiting":
      if (a.waiting_reason === "manual_mode") return "En attente : l’agent est arrêté (mode manuel)";
      if (a.waiting_reason === "unassigned") return "En attente : attribuer une campagne au prospect";
      return next && next > now
        ? `En attente d’autres emails du prospect (encore ${shortDuration(next - now)})`
        : "En attente d’autres emails du prospect";
    case "retrying":
      return a.next_attempt_at ? `Erreur technique : nouvel essai à ${clock(a.next_attempt_at)}` : "Erreur technique : nouvel essai bientôt";
    case "stalled":
      return "Traitement interrompu : il reprendra automatiquement";
    case "failed":
      return "Traitement abandonné après plusieurs erreurs : un conseiller doit répondre";
    case "done":
      return "Traitement terminé";
  }
}

/** Pastille courte pour une ligne de liste. */
export function activityTag(a: StateOnly): string {
  switch (a.state) {
    case "running":
      return "L’agent rédige…";
    case "queued":
      return "L’agent va répondre";
    case "waiting":
      return a.waiting_reason === "grouping" ? "Regroupe les emails" : "En attente";
    case "retrying":
    case "stalled":
      return "Nouvel essai prévu";
    case "failed":
      return "Échec de l’agent";
    case "done":
      return "Traité";
  }
}

