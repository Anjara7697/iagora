import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

const activity = {
  hours: 168,
  prospects_analysed: 12,
  drafts_generated: 9,
  sent_after_validation: 7,
  sent_without_validation: 0,
  escalations: 2,
  errors: 0,
};

async function mockApi(page: Page, role = "ADMIN", initial: "assisted" | "manual" = "assisted") {
  let mode = initial;
  const puts: unknown[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();
    let body: unknown = { detail: "Introuvable" };
    let status = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me") body = { id: 1, username: "nadia.cisse", role, email: "n@example.com" };
    else if (path === "/agent/mode") {
      if (method === "PUT") {
        const next = route.request().postDataJSON();
        puts.push(next);
        mode = next.mode;
      }
      body = { mode, updated_by: 1, updated_at: "2026-11-10T09:00:00Z" };
    } else if (path === "/dashboard/activity") body = activity;
    else if (path === "/settings")
      body = {
        agent_auto_reply: true,
        llm_model: "gemini-2.5-flash",
        follow_up_max_per_silence: 3,
        follow_up_window_start_hour: 8,
        follow_up_window_end_hour: 19,
        follow_up_weekdays_only: true,
      };
    else if (path === "/integrations/email")
      body = { configured: true, enabled: true, send_enabled: false, last_error: null };
    else if (path === "/integrations/calendar") body = { provider: "none", connections: [] };
    else if (path === "/integrations/zoom") body = { mode: "account", connections: [] };
    else if (path === "/integrations/meta") body = { configured: false, enabled: false };
    else if (path === "/todo") body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else status = 404;
    await route.fulfill({ status, json: body });
  });
  return puts;
}

async function open(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("nadia");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  // Attendre la fin de la connexion (jeton enregistré, redirection) avant de naviguer.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto("/agent");
}

test("agent : état, modes, activité et intégrations (administrateur)", async ({ page }) => {
  await mockApi(page);
  await open(page);
  await expect(page.getByRole("heading", { name: "Agent", exact: true })).toBeVisible();
  const state = page.getByRole("region", { name: "État de l’agent" });
  await expect(state).toContainText("Validation requise");
  const modes = page.getByRole("region", { name: "Modes de fonctionnement" });
  await expect(modes).toContainText("non activable depuis la console");
  await expect(modes.getByRole("button")).toHaveCount(0); // aucun moyen d'activer le mode automatique
  await expect(page.getByRole("region", { name: "Ce que fait l’agent" })).toContainText("gemini-2.5-flash");
  await expect(page.getByRole("region", { name: "Activité sur 7 jours" })).toContainText("prospects analysés");
  const integrations = page.getByRole("region", { name: "État des intégrations" });
  await expect(integrations).toContainText("envoi désactivé");
  await expect(integrations).toContainText("l’agent transfère les demandes de rendez-vous");
  await expect(page.getByRole("link", { name: "Réglages de l’agent" })).toHaveAttribute("href", "/settings?section=agent");
  await auditA11y(page, "agent");
});

test("agent : arrêt d'urgence confirmé puis reprise en mode assisté", async ({ page }) => {
  const puts = await mockApi(page, "ADVISOR");
  await open(page);
  await expect(page.getByRole("region", { name: "État des intégrations" })).toHaveCount(0); // administrateur seulement
  await page.getByRole("button", { name: "Arrêt d’urgence" }).click();
  const stop = page.getByRole("alertdialog", { name: "Arrêt d’urgence ?" });
  await stop.getByRole("button", { name: "Annuler" }).click();
  expect(puts).toHaveLength(0);
  await page.getByRole("button", { name: "Arrêt d’urgence" }).click();
  await stop.getByRole("button", { name: "Arrêter l’agent" }).click();
  await expect(page.getByText("Agent arrêté")).toBeVisible();
  await expect(page.getByRole("region", { name: "État de l’agent" })).toContainText("Arrêté");
  await page.getByRole("button", { name: "Reprendre en mode assisté" }).click();
  await page.getByRole("alertdialog", { name: "Reprendre en mode assisté ?" }).getByRole("button", { name: "Reprendre" }).click();
  await expect(page.getByText("Agent repris en mode assisté")).toBeVisible();
  expect(puts).toEqual([{ mode: "manual" }, { mode: "assisted" }]);
});

test("agent : un observateur consulte sans pouvoir arrêter", async ({ page }) => {
  await mockApi(page, "VIEWER", "manual");
  await open(page);
  await expect(page.getByRole("region", { name: "État de l’agent" })).toContainText("Arrêté");
  await expect(page.getByRole("button", { name: /Arrêt d’urgence|Reprendre/ })).toHaveCount(0);
  await expect(page.getByText(/accès observateur permet de consulter l’état/)).toBeVisible();
});
