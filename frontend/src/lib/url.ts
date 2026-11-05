/** Remplace l'URL courante sans recharger ni empiler d'historique : le retour navigateur ramène à l'écran précédent. */
export function replaceUrl(next: string) {
  if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, "", next);
}
