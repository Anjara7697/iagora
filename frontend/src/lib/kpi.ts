/** Lecture d'un indicateur : couleur du chiffre (bon, moyen, faible) et mot lu par les lecteurs d'écran. */
export type KpiBadge = { tone: "success" | "warning" | "danger"; label: string };

/** Pourcentage entier de `part` dans `total` (0 si `total` est nul). */
export const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/*
 * Seuils indicatifs, à ajuster avec l'équipe commerciale (aucune source de données ne les fixe) :
 * qualification = qualifiés / leads ; inscription = inscrits / leads.
 */
export const RATE_THRESHOLDS = {
  qualification: { good: 40, ok: 20 },
  enrolment: { good: 10, ok: 3 },
} as const;

/** « Bon » à partir de `good` %, « Moyen » à partir de `ok` %, sinon « Faible ». */
export function rateBadge(value: number, { good, ok }: { good: number; ok: number }): KpiBadge {
  if (value >= good) return { tone: "success", label: "Bon" };
  if (value >= ok) return { tone: "warning", label: "Moyen" };
  return { tone: "danger", label: "Faible" };
}
