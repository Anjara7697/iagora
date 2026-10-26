import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "Europe/Paris" });

const scheduled = {
  id: 1, prospect: { id: 11, first_name: "Alice", last_name: "Martin", email: "alice@demo.example.com" },
  advisor_id: 7, advisor_name: "Nadia", start_at: "2026-10-27T09:00:00Z", end_at: "2026-10-27T10:00:00Z",
  status: "scheduled", meeting_url: "https://zoom.example/meeting-demo",
};
const cancelled = {
  ...scheduled, id: 2, advisor_id: null, advisor_name: null, status: "cancelled", meeting_url: null,
  prospect: { ...scheduled.prospect, id: 12, first_name: "Sam", last_name: "Test", email: "sam@demo.example.com" },
};
async function mockApi(page: Page, role = "ADVISOR") {
  const queries: URLSearchParams[] = [];
  const writes: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    if (request.method() !== "GET" && path !== "/auth/login") writes.push(path);
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "test-session" };
    else if (path === "/auth/me") body = { id: 7, username: "Nadia", role, email: "nadia@demo.example.com" };
    else if (path === "/todo") body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/advisors") body = { items: [{ id: 7, username: "Nadia" }, { id: 8, username: "Louis" }], total: 2, limit: 200, offset: 0 };
    else if (path === "/appointments") {
      queries.push(url.searchParams);
      const status = url.searchParams.get("status");
      let items = [scheduled, cancelled];
      const advisor = url.searchParams.get("advisor_id");
      if (advisor) items = items.filter(a => String(a.advisor_id) === advisor);
      if (status) items = items.filter(a => a.status === status);
      if (url.searchParams.get("demo") === "exclude") items = [];
      const offset = Number(url.searchParams.get("offset") ?? 0);
      body = { items, total: items.length ? 26 : 0, limit: 25, offset };
    } else code = 404;
    await route.fulfill({ status: code, json: body });
  });
  return { queries, writes };
}
async function open(page: Page, path = "/appointments") {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("nadia");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto(path);
}

test("conseiller : rendez-vous personnels, liens et navigation active", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  await expect(page.getByRole("heading", { name: "Rendez-vous", exact: true })).toBeVisible();
  await expect(page.getByLabel("Conseiller", { exact: true })).toHaveValue("me");
  const list = page.getByRole("list", { name: "Rendez-vous enregistrés" });
  await expect(list.getByRole("link", { name: "Alice Martin", exact: true })).toHaveAttribute("href", "/prospects/11");
  await expect(list.getByRole("link", { name: /Ouvrir la visio/ })).toHaveAttribute("href", scheduled.meeting_url);
  await expect(list.getByRole("link", { name: /Ouvrir la visio/ })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(list.getByText("Fictif", { exact: true })).toBeVisible();
  await expect(list.locator("time").first()).toContainText("10:00");
  await expect(page.getByText(/Horaires : Europe\/Paris/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Rendez-vous", exact: true })).toHaveAttribute("aria-current", "page");
  expect(calls.queries.at(-1)?.get("advisor_id")).toBe("7");
  expect(calls.writes).toEqual([]);
});

test("filtres combinés, pagination, actualisation et retour navigateur", async ({ page }) => {
  const calls = await mockApi(page, "ADMIN");
  await open(page);
  await page.getByRole("button", { name: "Passés", exact: true }).click();
  await page.getByLabel("Conseiller", { exact: true }).selectOption("7");
  await page.getByLabel("Statut", { exact: true }).selectOption("scheduled");
  await expect(page.getByText("1-25 sur 26", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Suivant" }).click();
  await expect(page.getByText("26-26 sur 26", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Passés", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("26-26 sur 26", { exact: true })).toBeVisible();
  for (const [key, value] of Object.entries({ when: "past", status: "scheduled", advisor_id: "7", offset: "25" })) expect(calls.queries.at(-1)?.get(key)).toBe(value);
  await expect(page.getByText("Planifié", { exact: true }).last()).toBeVisible();
  await page.getByLabel("Masquer les prospects fictifs").check();
  await expect(page.getByRole("heading", { name: "Aucun rendez-vous pour cette sélection" })).toBeVisible();
  expect(calls.queries.at(-1)?.get("offset")).toBe("0");
  await page.goBack();
  await expect(page.getByText("26-26 sur 26", { exact: true })).toBeVisible();
  expect(calls.writes).toEqual([]);
});

test("mobile et observateur : toutes les réservations, lien absent et dates avec fuseau", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockApi(page, "VIEWER");
  await open(page);
  const list = page.getByRole("list", { name: "Rendez-vous enregistrés" });
  await expect(list.getByText("Annulé", { exact: true })).toBeVisible();
  await expect(list.getByText("Lien visio non disponible")).toBeVisible();
  await expect(list.getByText("Conseiller : Non affecté")).toBeVisible();
  await expect(page.getByText(/Horaires :/)).toBeVisible();
  expect(calls.queries.at(-1)?.has("advisor_id")).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls.writes).toEqual([]);
});

test("erreur récupérable, page devenue vide et URL visio non navigable", async ({ page }) => {
  await mockApi(page);
  let failed = true;
  await page.route("**/api/v1/appointments?**", route => route.fulfill(failed
    ? { status: 503, json: { detail: "Consultation indisponible" } }
    : { json: { items: [], total: 1, limit: 25, offset: 25 } }));
  await open(page, "/appointments?offset=25");
  await expect(page.getByRole("alert").filter({ hasText: "Consultation indisponible" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aucun rendez-vous pour cette sélection" })).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aucun rendez-vous sur cette page" })).toBeVisible();
  await page.route("**/api/v1/appointments?**", route => route.fulfill({ json: {
    items: [{ ...scheduled, meeting_url: "javascript:alert(1)" }], total: 1, limit: 25, offset: 0,
  } }));
  await page.getByRole("button", { name: "Revenir à la première page" }).click();
  await expect(page.getByText("Lien visio non disponible")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ouvrir la visio/ })).toHaveCount(0);
});
