import { expect, test } from "@playwright/test";
import { auditA11y } from "./a11y";
import { mockConsole, NOW } from "./fixtures/console";

/** Pages d'erreur et titre du document (ARCH-02, A11Y-03), sur le jeu de données fixe des captures de référence. */

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test("adresse inconnue : page introuvable dans la console, titre et retour à l'accueil", { tag: ["@mobile", "@sombre"] }, async ({ page }) => {
  await mockConsole(page);
  const response = await page.goto("/cet-ecran-n-existe-pas");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page introuvable", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Page introuvable · IAGORA");
  await expect(page.getByRole("banner")).toBeVisible();
  await auditA11y(page, "page introuvable");
  await page.getByRole("link", { name: "Revenir à Aujourd’hui" }).click();
  await expect(page.getByRole("heading", { name: "Bonjour Nadia" })).toBeVisible();
  await expect(page).toHaveTitle("Aujourd’hui · IAGORA");
});

test("erreur d'affichage : message en français, menu conservé, « Réessayer » réaffiche l'écran", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await mockConsole(page);
  // Réponse incomplète de l'API : l'écran d'accueil échoue à l'affichage.
  let broken = true;
  await page.route("**/api/v1/dashboard/summary", (route) => (broken ? route.fulfill({ json: {} }) : route.fallback()));
  await page.goto("/");

  const alert = page.getByRole("alert").filter({ hasText: "Cet écran n’a pas pu s’afficher" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Les données déjà enregistrées ne sont pas touchées");
  await expect(page.getByText(/Application error|client-side exception/)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  await auditA11y(page, "erreur d'affichage");

  broken = false;
  await alert.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { name: "Bonjour Nadia" })).toBeVisible();
  await expect(alert).toHaveCount(0);
  // Le détail technique n'est pas à l'écran, mais reste dans la console du navigateur.
  expect(errors.join("\n")).toMatch(/TypeError/);
});

test("titre du document propre à chaque écran, mis à jour en naviguant", async ({ page }) => {
  await mockConsole(page);
  await page.goto("/login");
  await expect(page).toHaveTitle("Connexion · IAGORA");
  await page.goto("/campaigns/1");
  await expect(page.getByRole("heading", { name: "Recrutement eBIHAR 2026", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Campagne · IAGORA");
  await page.goto("/prospects");
  await expect(page).toHaveTitle("Prospects · IAGORA");
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Paramètres" }).click();
  await expect(page.getByRole("heading", { name: "Paramètres", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Paramètres · IAGORA");
});
