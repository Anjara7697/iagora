import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url);

/**
 * `@/lib/x` → `src/lib/x.ts` ; `./x` (sans extension) → `./x.ts`. Un fichier `.ts` est déclaré module ES
 * (le `package.json` de la console n'a pas de champ `type`). Le reste suit la résolution de Node.
 */
export async function resolve(specifier, context, next) {
  const resolved = await resolveFile(specifier, context, next);
  return resolved.url.endsWith(".ts") ? { ...resolved, format: "module-typescript" } : resolved;
}

async function resolveFile(specifier, context, next) {
  let target = null;
  if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), SRC);
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts"))
    target = new URL(specifier, context.parentURL);
  if (target && !/\.[cm]?[jt]sx?$/.test(target.pathname)) {
    for (const ext of [".ts", ".tsx"]) {
      const file = fileURLToPath(target) + ext;
      if (existsSync(file)) return next(pathToFileURL(file).href, context);
    }
  }
  return next(target ? target.href : specifier, context);
}
