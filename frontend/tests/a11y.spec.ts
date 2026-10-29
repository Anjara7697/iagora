import { test } from "@playwright/test";
import { auditA11y } from "./a11y";

test("connexion : aucune violation d'accessibilité grave", async ({ page }) => {
  await page.goto("/login");
  await auditA11y(page, "connexion");
});

test("connexion sur mobile : aucune violation d'accessibilité grave", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await auditA11y(page, "connexion (mobile)");
});
