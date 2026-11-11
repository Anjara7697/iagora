import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

const analytics = (days: number, empty = false) => ({
  days,
  since: "2026-10-12T10:00:00Z",
  first_reply_sent: empty ? { median_seconds: null, count: 0 } : { median_seconds: 5400, count: 12 },
  first_reply_drafted: empty ? { median_seconds: null, count: 0 } : { median_seconds: 42, count: 15 },
  average_confidence: empty ? null : 0.84,
  drafts: empty
    ? { generated: 0, approved_unchanged: 0, approved_edited: 0, rejected: 0, superseded: 0, pending: 0 }
    : { generated: 20, approved_unchanged: 11, approved_edited: 5, rejected: 3, superseded: 0, pending: 1 },
  reject_reasons: empty ? [] : [{ reason: "Ton trop familier", count: 2 }, { reason: "Programme erroné", count: 1 }],
  coverage: empty ? { questions: 0, answered: 0 } : { questions: 10, answered: 8 },
  funnel: [
    { key: "leads", label: "Leads reçus", count: empty ? 0 : 40 },
    { key: "qualified", label: "Qualifiés", count: empty ? 0 : 20 },
    { key: "meeting", label: "Rendez-vous planifiés", count: empty ? 0 : 5 },
    { key: "applied", label: "Candidatures", count: 0 },
    { key: "converted", label: "Inscrits", count: 0 },
  ],
});

async function mockApi(page: Page, opts: { empty?: boolean; fail?: boolean } = {}) {
  const asked: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = { detail: "Introuvable" };
    let status = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me") body = { id: 1, username: "nadia.cisse", role: "ADMIN", email: "n@example.com" };
    else if (path === "/analytics") {
      asked.push(url.searchParams.get("days") ?? "");
      if (opts.fail) {
        status = 500;
        body = { detail: "Erreur interne du serveur" };
      } else body = analytics(Number(url.searchParams.get("days")), opts.empty);
    } else if (path === "/todo") body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else status = 404;
    await route.fulfill({ status, json: body });
  });
  return asked;
}

async function open(page: Page, path = "/analytics") {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("nadia");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  // Attendre la fin de la connexion (jeton enregistré, redirection) avant de naviguer.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto(path);
}

test("analyses : indicateurs mesurés, « Pas encore mesuré » et répartitions", async ({ page }) => {
  await mockApi(page);
  await open(page);
  await expect(page.getByRole("heading", { name: "Analyses", exact: true })).toBeVisible();
  const kpis = page.getByRole("region", { name: "Indicateurs" });
  await expect(kpis).toContainText("1 h 30"); // 5 400 s, envoi réel
  await expect(kpis).toContainText("rédaction de l’agent : 42 s");
  await expect(kpis).toContainText("84 %");
  await expect(kpis).toContainText("80 %"); // couverture 8/10
  await expect(kpis).toContainText("Pas encore mesuré"); // escalades utiles
  await expect(page.getByRole("region", { name: "Devenir des brouillons" })).toContainText("Validés après modification");
  await expect(page.getByRole("region", { name: "Motifs de refus" })).toContainText("Ton trop familier");
  await expect(page.getByRole("region", { name: "Conversion par étape" }).getByText("25 % de l’étape précédente")).toBeVisible();
  await auditA11y(page, "analyses");
});

test("analyses : période dans l'adresse, période vide et panne", async ({ page }) => {
  const asked = await mockApi(page, { empty: true });
  await open(page, "/analytics?days=7");
  await expect(page.getByRole("tab", { name: "7 jours" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => asked.at(-1)).toBe("7");
  await expect(page.getByText("Aucun brouillon sur la période.")).toBeVisible();
  await expect(page.getByText("Aucun refus sur la période.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicateurs" })).toContainText("aucune question sur la période");
  await page.getByRole("tab", { name: "90 jours" }).click();
  await expect(page).toHaveURL(/\/analytics\?days=90$/);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockApi(page, { fail: true });
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Analyses indisponibles" })).toBeVisible();
});
