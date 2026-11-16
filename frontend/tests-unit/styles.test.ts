import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** Fichiers .tsx de `src`. */
function sources(dir = new URL("../src", import.meta.url).pathname): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Lignes de `src` où `pattern` apparaît, sous la forme « fichier:ligne : extrait ». */
function find(pattern: RegExp): string[] {
  return sources().flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, i) => (pattern.test(line) ? [`${file.split("/src/")[1]}:${i + 1} : ${line.trim().slice(0, 100)}`] : [])),
  );
}

test("échelle de texte : aucune taille en pixels (type-caption… type-display, heroui.css)", () => {
  assert.deepEqual(find(/\btext-\[\d+(\.\d+)?px\]/), []);
});

test("échelle de texte : pas d'interligne accolé à une classe type-* (classe invalide, taille perdue)", () => {
  // « type-caption/[18px] » n'existe pas : écrire « type-caption leading-4.5 ».
  assert.deepEqual(find(/\btype-[a-z-]+\//), []);
});

test("rayons : seulement sm, lg et full (hors bulles du fil de Conversations, règle 7)", () => {
  assert.deepEqual(
    find(/\brounded-(xl|2xl|3xl|md)\b/).filter((hit) => !hit.startsWith("components/conversations/ConversationView.tsx")),
    [],
  );
});

test("nombres : saisis dans NumberInput, jamais en type=\"number\" brut (un champ vidé deviendrait 0, FORM-01)", () => {
  assert.deepEqual(
    find(/type="number"/).filter((hit) => !hit.startsWith("components/ds/controls.tsx")),
    [],
  );
});
