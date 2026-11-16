import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.0, 2.1 et 2.2, niveaux A et AA (dont la taille des cibles, 2.5.8, et le nom qui contient le texte visible). */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Audit d'accessibilité automatisé de l'écran affiché : aucune violation grave ou critique des critères WCAG 2.2 A et
 * AA. `strict` (captures de référence) : aucune violation modérée non plus, bonnes pratiques axe comprises (titres
 * dans l'ordre, un titre de niveau 1…). Mouvement réduit : les transitions ne faussent pas les calculs de contraste.
 */
export async function auditA11y(
  page: Page,
  label: string,
  exclude: string[] = [],
  { strict = false }: { strict?: boolean } = {},
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  const builder = new AxeBuilder({ page }).withTags(strict ? [...WCAG, "best-practice"] : WCAG);
  for (const selector of exclude) builder.exclude(selector);
  const results = await builder.analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical" || (strict && v.impact === "moderate"))
    .map((v) => ({
      règle: v.id,
      impact: v.impact,
      aide: v.help,
      éléments: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
  expect(serious, `Accessibilité : ${label}`).toEqual([]);
}
