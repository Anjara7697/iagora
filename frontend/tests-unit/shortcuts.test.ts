import assert from "node:assert/strict";
import { test } from "node:test";
import { activeShortcuts, ariaKeyShortcut, matches, registerShortcuts } from "@/lib/shortcuts";

const press = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("une lettre seule correspond, majuscule verrouillée comprise", () => {
  assert.ok(matches(press("j"), { key: "j" }));
  assert.ok(matches(press("J"), { key: "j" }));
  assert.ok(!matches(press("k"), { key: "j" }));
});

test("une lettre avec ⌘, Ctrl, Alt ou Maj ne déclenche pas le raccourci de la lettre seule", () => {
  for (const mod of ["metaKey", "ctrlKey", "altKey", "shiftKey"] as const) assert.ok(!matches(press("j", { [mod]: true }), { key: "j" }));
});

test("⌘ Entrée et Ctrl Entrée valident, Entrée seule non", () => {
  const approve = { key: "Enter", mod: true };
  assert.ok(matches(press("Enter", { metaKey: true }), approve));
  assert.ok(matches(press("Enter", { ctrlKey: true }), approve));
  assert.ok(!matches(press("Enter"), approve));
  assert.ok(!matches(press("Enter", { ctrlKey: true, shiftKey: true }), approve));
});

test("aria-keyshortcuts selon le système", () => {
  assert.equal(ariaKeyShortcut({ key: "j" }, false), "J");
  assert.equal(ariaKeyShortcut({ key: "Enter", mod: true }, true), "Meta+Enter");
  assert.equal(ariaKeyShortcut({ key: "Enter", mod: true }, false), "Control+Enter");
});

test("seuls les raccourcis disponibles des écrans affichés sont listés", () => {
  const run = () => {};
  const offA = registerShortcuts(() => [
    { key: "j", label: "Suivant", run },
    { key: "k", label: "Précédent", run, disabled: true },
  ]);
  const offB = registerShortcuts(() => [{ key: "m", label: "Modifier", run }]);
  assert.deepEqual(activeShortcuts().map((s) => s.label), ["Suivant", "Modifier"]);
  offA();
  assert.deepEqual(activeShortcuts().map((s) => s.label), ["Modifier"]);
  offB();
  assert.deepEqual(activeShortcuts(), []);
});
