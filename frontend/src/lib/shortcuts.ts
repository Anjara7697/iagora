/**
 * Raccourcis clavier d'un écran (« À traiter ») : définition, correspondance avec une touche, et liste de ceux
 * actifs, que la palette affiche. Sans dépendance au DOM, pour les tests unitaires ; l'écoute est dans
 * `useShortcuts`.
 */

/** Touche d'un raccourci : une lettre seule, ou `mod` (⌘ sur Mac, Ctrl ailleurs) avec une touche. */
export type ShortcutKey = { key: string; mod?: boolean };

export type Shortcut = ShortcutKey & {
  /** Intitulé de l'action, affiché dans la palette et les infobulles. */
  label: string;
  run: () => void;
  /** Action indisponible pour l'instant (élément absent, envoi en cours, accès observateur…). */
  disabled?: boolean;
};

type KeyInput = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** Vrai si la touche pressée est celle du raccourci : Alt et Maj l'empêchent, `mod` doit correspondre. */
export function matches(event: KeyInput, shortcut: ShortcutKey): boolean {
  if (event.altKey || event.shiftKey) return false;
  if ((event.metaKey || event.ctrlKey) !== !!shortcut.mod) return false;
  return event.key.toLowerCase() === shortcut.key.toLowerCase();
}

/** Valeur d'`aria-keyshortcuts` (lue par les lecteurs d'écran). */
export function ariaKeyShortcut(shortcut: ShortcutKey, mac: boolean): string {
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return shortcut.mod ? `${mac ? "Meta" : "Control"}+${key}` : key;
}

const active = new Map<symbol, () => Shortcut[]>();

/** Enregistre les raccourcis d'un écran tant qu'il est affiché ; renvoie la fonction qui les retire. */
export function registerShortcuts(read: () => Shortcut[]): () => void {
  const id = Symbol("shortcuts");
  active.set(id, read);
  return () => {
    active.delete(id);
  };
}

/** Raccourcis disponibles en ce moment, dans l'ordre d'enregistrement. */
export function activeShortcuts(): Shortcut[] {
  return [...active.values()].flatMap((read) => read()).filter((s) => !s.disabled);
}
