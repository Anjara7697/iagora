import { SIMULATOR_ENABLED } from "./api";
import type { User } from "./types";

/** Visibilité des outils : les droits effectifs restent contrôlés par l’API. */
export function canUseSimulator(role: User["role"] | undefined): boolean {
  return SIMULATOR_ENABLED && (role === "ADMIN" || role === "ADVISOR");
}

export function canAccessSettings(role: User["role"]): boolean {
  return role === "ADMIN" || canUseSimulator(role);
}
