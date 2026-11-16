import { expect, test } from "@playwright/test";
import { auditA11y } from "./a11y";
import { mockConsole, NOW } from "./fixtures/console";

/**
 * Captures de référence des écrans principaux, avant la refonte (lot 1 de
 * `docs/frontend/audit/FRONTEND_REFACTORING_ROADMAP.md`). Chaque écran est rendu sur un jeu de données fixe, puis :
 * - comparé à sa capture de référence (`tests/__screenshots__/`), en CI seulement (voir `playwright.config.ts`) ;
 * - vérifié sans défilement horizontal de la page ;
 * - audité par axe.
 * Les étiquettes font aussi tourner ces tests en mobile (390 px) et en thème sombre.
 * Mettre à jour les captures après un changement voulu : `npm run test:visual:update` (voir `docs/frontend/heroui.md`).
 */

const SCREENS = [
  { name: "connexion", path: "/login", heading: "Bienvenue sur IAGORA" },
  { name: "aujourdhui", path: "/", heading: "Bonjour Nadia" },
  { name: "a-traiter", path: "/todo?id=draft%3Ac1%3Am1", heading: "À traiter", ready: "Valider la réponse" },
  { name: "conversations", path: "/conversations?id=c1", heading: "Conversations", ready: "dure 18 mois" },
  { name: "prospects", path: "/prospects", heading: "Prospects", ready: "Sophie Merlin" },
  { name: "fiche-prospect", path: "/prospects/1", heading: "Marie Dupont" },
  { name: "campagnes", path: "/campaigns", heading: "Campagnes", ready: "Recrutement eBIHAR 2026" },
  { name: "fiche-campagne", path: "/campaigns/1", heading: "Recrutement eBIHAR 2026" },
  { name: "tableau-de-bord", path: "/dashboard", heading: "Tableau de bord" },
  { name: "integrations", path: "/integrations", heading: "Intégrations", ready: "Messagerie email" },
  { name: "parametres", path: "/settings", heading: "Paramètres", ready: "Modèle" },
  { name: "equipe", path: "/team", heading: "Équipe", ready: "paul.martin" },
] as const;

test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

for (const screen of SCREENS) {
  test(`capture de référence : ${screen.name}`, { tag: ["@mobile", "@sombre"] }, async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    const unexpected = await mockConsole(page);
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading, exact: true })).toBeVisible();
    if ("ready" in screen) await expect(page.getByText(new RegExp(screen.ready)).filter({ visible: true }).first()).toBeVisible();
    // Plus aucun chargement en cours (squelettes, « Chargement… ») avant la capture.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(unexpected, "requêtes sans réponse prévue dans tests/fixtures/console.ts").toEqual([]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "défilement horizontal de la page").toBeLessThanOrEqual(0);

    await expect(page).toHaveScreenshot(`${screen.name}.png`, { fullPage: true });
    await auditA11y(page, screen.name, [], { strict: true });
  });
}

test("chiffres clés : une valeur colorée garde la taille des chiffres", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await mockConsole(page);
  await page.goto("/campaigns");
  const values = page.getByRole("region", { name: "Chiffres clés" }).locator(".card__title");
  await expect(values).toHaveCount(4);
  // La taille de l'échelle (type-display) ne doit pas être retirée par la fusion des classes quand une couleur s'ajoute.
  for (const size of await values.evaluateAll((els) => els.map((el) => getComputedStyle(el).fontSize)))
    expect(size).toBe("28px");
});
