/**
 * Pages à afficher (PERF-05) : toutes jusqu'à 7, sinon la première, la dernière et les voisines de la page courante,
 * `null` marquant un saut (« 1 … 4 5 6 … 12 »). Toujours 7 positions au plus : la barre garde sa largeur.
 */
export function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, null, pages];
  if (page >= pages - 3) return [1, null, pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, null, page - 1, page, page + 1, null, pages];
}
