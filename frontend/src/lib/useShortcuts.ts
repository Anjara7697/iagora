"use client";

import { useEffect, useRef } from "react";
import { matches, registerShortcuts, type Shortcut } from "./shortcuts";

const NOT_TEXT = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"]);

/** Le focus est dans une zone de saisie : la touche y écrit, elle ne déclenche rien. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NOT_TEXT.has(target.type);
  return !!target.closest('[role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"]');
}

/**
 * Une fenêtre est ouverte (confirmation, palette, panneau) ou le focus est dans un menu ou une notification : la
 * touche lui revient. Les notifications (Toast) sont des `alertdialog` sans voile : elles ne bloquent que si le
 * focus y est.
 */
function inOverlay(target: EventTarget | null): boolean {
  if (document.querySelector('[data-slot="modal-backdrop"], [data-slot="alert-dialog-backdrop"], [data-slot="drawer-backdrop"]'))
    return true;
  return target instanceof Element && !!target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
}

/**
 * Écoute les raccourcis d'un écran tant qu'il est affiché, et les rend visibles dans la palette (⌘K). Une touche
 * ne déclenche rien quand le focus est dans un champ de saisie, quand une fenêtre (confirmation, palette, menu)
 * est ouverte, ni quand elle est maintenue enfoncée. Elle est écoutée à la capture : un raccourci qui se déclenche
 * ne passe pas à l'élément focalisé.
 */
export function useShortcuts(shortcuts: Shortcut[]) {
  const current = useRef(shortcuts);
  useEffect(() => {
    current.current = shortcuts;
  });
  useEffect(() => {
    const unregister = registerShortcuts(() => current.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (isTextEntry(event.target)) return;
      if (inOverlay(event.target)) return;
      const shortcut = current.current.find((s) => !s.disabled && matches(event, s));
      if (!shortcut) return;
      // Capturé avant le bouton qui a le focus : ⌘ Entrée valide toujours, même quand « Refuser » est focalisé.
      event.preventDefault();
      event.stopPropagation();
      shortcut.run();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      unregister();
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);
}
