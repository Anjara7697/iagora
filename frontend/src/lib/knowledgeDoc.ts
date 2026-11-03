/**
 * Documents de la base de connaissances : Markdown avec un en-tête (`title:`, `target:`), lu par le backend
 * (`app/integrations/knowledge/chunking.py`). L'éditeur sépare l'en-tête en champs (titre, programme) et
 * le régénère à l'enregistrement ; toute autre ligne d'en-tête est conservée telle quelle.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Identifiant à partir d'un titre ou d'un nom de fichier : minuscules, sans accents, mots séparés par des tirets. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.md$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type DocumentParts = {
  title: string;
  /** Code du programme ; vide = tous les programmes. */
  target: string;
  body: string;
  /** Autres lignes d'en-tête, recopiées à l'identique. */
  extra: string[];
};

/** Même lecture que le backend : en-tête entre `---`, clés insensibles à la casse, `target: all` = tous. */
export function splitDocument(raw: string): DocumentParts {
  const parts: DocumentParts = { title: "", target: "", body: raw, extra: [] };
  if (!raw.startsWith("---")) return parts;
  const end = raw.indexOf("\n---");
  if (end === -1) return parts;
  for (const line of raw.slice(0, end).split("\n").slice(1)) {
    if (!line.trim()) continue;
    const at = line.indexOf(":");
    const key = at === -1 ? "" : line.slice(0, at).trim().toLowerCase();
    const value = at === -1 ? "" : line.slice(at + 1).trim();
    if (key === "title") parts.title = value;
    else if (key === "target") parts.target = value.toLowerCase() === "all" ? "" : value;
    else parts.extra.push(line);
  }
  parts.body = raw.slice(end + 4).replace(/^[^\n]*\n?/, "").replace(/^\n+/, "");
  return parts;
}

export function composeDocument({ title, target, body, extra }: DocumentParts): string {
  const header = [`title: ${title.trim()}`, ...(target ? [`target: ${target}`] : []), ...extra];
  return `---\n${header.join("\n")}\n---\n${body.replace(/^\n+/, "")}`;
}

export const BODY_TEMPLATE = `## Première section
Un fait par phrase claire, par exemple : le programme dure 18 mois.

## Deuxième section
Conditions d'admission, rythme, financement…
`;
