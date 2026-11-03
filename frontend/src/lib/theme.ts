/**
 * Thème de la console : clair, sombre ou celui du système. Le choix est gardé dans le navigateur et appliqué par
 * l'attribut `data-theme` de <html> (lu par HeroUI et par heroui.css), avant le premier affichage grâce au script
 * de `THEME_BOOT_SCRIPT` (pas de flash du mauvais thème au rechargement).
 */
export type ThemePreference = "light" | "dark" | "system";
export const THEME_KEY = "iagora.theme";

export function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_KEY, preference);
  } catch {
    /* stockage indisponible : le choix vaut pour cette page seulement */
  }
  applyTheme(preference);
}

/** Exécuté dans <head> avant l'affichage : même logique que `applyTheme`, sans dépendance. */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");if(p!=="light"&&p!=="dark")p="system";var t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",t==="dark");r.style.colorScheme=t;}catch(e){}})();`;
