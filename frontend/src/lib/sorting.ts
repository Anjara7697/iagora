/**
 * Tri d'un tableau côté serveur, porté par l'URL (`?sort=name`, `?sort=-name`) : le paramètre de l'API, `-` devant
 * le champ pour l'ordre décroissant. Seuls les champs prévus par l'écran sont relus.
 */
export type SortDirection = "ascending" | "descending";
export type SortState = { column: string; direction: SortDirection };

/** Valeur de tri relue de l'URL : `""` si absente ou inconnue (ordre par défaut de l'API). */
export function readSort(value: string | null, fields: readonly string[]): string {
  if (!value) return "";
  return fields.includes(value.replace(/^-/, "")) ? value : "";
}

/** Paramètre d'API → état du tableau (colonne et sens). */
export function sortState(param: string): SortState | null {
  if (!param) return null;
  const descending = param.startsWith("-");
  return { column: descending ? param.slice(1) : param, direction: descending ? "descending" : "ascending" };
}

/** État du tableau → paramètre d'API. */
export function sortParam(state: SortState): string {
  return `${state.direction === "descending" ? "-" : ""}${state.column}`;
}
