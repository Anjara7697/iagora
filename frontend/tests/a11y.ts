import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Audit d'accessibilité automatisé (WCAG 2 A et AA) de l'écran affiché : aucune violation grave.
 *  Mouvement réduit : les transitions ne faussent pas les calculs de contraste. */
export async function auditA11y(
  page: Page,
  label: string,
  exclude: string[] = [],
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  for (const selector of exclude) builder.exclude(selector);
  const results = await builder.analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      règle: v.id,
      impact: v.impact,
      aide: v.help,
      éléments: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
  expect(serious, `Accessibilité : ${label}`).toEqual([]);
}
