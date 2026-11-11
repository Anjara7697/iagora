import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

const overview = (days: number) => ({
  days,
  since: "2026-10-12T10:00:00Z",
  leads: 40,
  funnel: [
    { key: "leads", label: "Leads reçus", count: 40 },
    { key: "qualified", label: "Qualifiés", count: 20 },
    { key: "meeting", label: "Rendez-vous planifiés", count: 8 },
    { key: "applied", label: "Candidatures", count: 4 },
    { key: "converted", label: "Inscrits", count: 3 },
  ],
  by_target: [
    { key: "ebihar_students", label: "Étudiants eBIHAR", count: 30 },
    { key: null, label: "Non renseigné", count: 10 },
  ],
  by_source: [{ key: "1", label: "LinkedIn", count: 40 }],
});

async function mockApi(page: Page, opts: { fail?: boolean; incident?: boolean; empty?: boolean } = {}) {
  const asked: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = { detail: "Introuvable" };
    let status = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me") body = { id: 1, username: "nadia.cisse", role: "ADMIN", email: "n@example.com" };
    else if (path === "/dashboard/overview") {
      asked.push(url.searchParams.get("days") ?? "");
      if (opts.fail) {
        status = 500;
        body = { detail: "Erreur interne du serveur" };
      } else body = opts.empty ? { ...overview(30), leads: 0, funnel: [], by_target: [], by_source: [] } : overview(Number(url.searchParams.get("days")));
    } else if (path === "/todo") {
      const incident = opts.incident && url.searchParams.get("kind") === "incident";
      body = {
        items: incident ? [{ id: "incident:1", kind: "incident", title: "La source LinkedIn n’apporte plus de leads", detail: "Aucun lead depuis 3 jours." }] : [],
        total: incident ? 1 : 0,
        limit: 1,
        offset: 0,
        counts: {},
      };
    } else status = 404;
    await route.fulfill({ status, json: body });
  });
  return asked;
}

async function open(page: Page, path = "/dashboard") {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("nadia");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto(path);
}

test("tableau de bord : chiffres clés, entonnoir en étapes atteintes et répartitions", async ({ page }) => {
  await mockApi(page);
  await open(page);
  await expect(page.getByRole("heading", { name: "Tableau de bord", exact: true })).toBeVisible();
  const kpis = page.getByRole("region", { name: "Chiffres clés" });
  await expect(kpis).toContainText("Leads reçus");
  await expect(kpis).toContainText("50 % des leads");
  const funnel = page.getByRole("region", { name: "Entonnoir" });
  await expect(funnel.getByText("40 % de l’étape précédente")).toBeVisible(); // 8 rendez-vous / 20 qualifiés
  await expect(funnel.getByText(/reste compté dans « Rendez-vous planifiés »/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Par programme" })).toContainText("Non renseigné");
  await expect(page.getByRole("region", { name: "Par source" })).toContainText("LinkedIn");
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Tableau de bord" })).toHaveAttribute("aria-current", "page");
  await auditA11y(page, "tableau de bord");
});

test("période dans l'adresse et export CSV de la synthèse", async ({ page }) => {
  const asked = await mockApi(page);
  await open(page, "/dashboard?days=90");
  await expect(page.getByRole("tab", { name: "90 jours" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "7 jours" }).click();
  await expect(page).toHaveURL(/\/dashboard\?days=7$/);
  await expect.poll(() => asked.at(-1)).toBe("7");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter en CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("tableau-de-bord-7j.csv");
  const text = (await (await file.createReadStream()).toArray()).join("");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain('"Entonnoir";"Inscrits";"3"');
  expect(text).toContain('"Par source";"LinkedIn";"40"');
  await page.goto("/dashboard?days=12");
  await expect(page.getByRole("tab", { name: "30 jours" })).toHaveAttribute("aria-selected", "true");
});

test("incident en bandeau, période vide et panne avec nouvelle tentative", async ({ page }) => {
  await mockApi(page, { incident: true, empty: true });
  await open(page);
  const alert = page.getByRole("alert").filter({ hasText: "n’apporte plus de leads" });
  await expect(alert.getByRole("link", { name: "Diagnostiquer" })).toHaveAttribute("href", /\/todo\?id=incident/);
  await expect(page.getByRole("region", { name: "Entonnoir" }).getByText("Aucun prospect sur la période.")).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockApi(page, { fail: true });
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Tableau de bord indisponible" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
});
