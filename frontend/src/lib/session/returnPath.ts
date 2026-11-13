/**
 * Adresse de retour après la connexion (NAV-03) : la page où la session a expiré, transmise par `/login?next=…`.
 * Comme pour les autres adresses de retour (règle 6 des parcours), elle n'est jamais suivie telle quelle : seul un
 * chemin interne vers un écran connu de la console est gardé, avec ses paramètres (que chaque écran relit en ne
 * retenant que les valeurs connues). Le fragment (`#…`) est abandonné.
 */
const BASE = "http://console.invalid";

const SCREENS = [
  /^\/$/,
  /^\/(todo|conversations|appointments|prospects|prospects\/import|campaigns|campaigns\/new|dashboard|analytics|agent|knowledge|team|integrations|settings|settings\/testing|simulator|account)$/,
  /^\/(prospects|campaigns)\/[1-9]\d{0,9}$/,
];

export function returnPath(value: string | null | undefined): string | null {
  if (!value || value.length > 2000 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  // Chemin réécrit par l'analyse (`/prospects/../team`, encodage) : refusé plutôt que deviné.
  if (url.origin !== BASE || url.pathname !== value.split(/[?#]/)[0]) return null;
  if (!SCREENS.some((screen) => screen.test(url.pathname))) return null;
  return url.pathname + url.search;
}

/** Page de connexion qui ramènera à `current` une fois connecté (rien à ajouter pour l'accueil ou une adresse refusée). */
export function loginHref(current: string): string {
  const back = returnPath(current);
  return back && back !== "/" ? `/login?next=${encodeURIComponent(back)}` : "/login";
}
