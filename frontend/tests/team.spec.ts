import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

const members = [
  {
    id: 1,
    username: "admin",
    email: "a@example.com",
    role: "ADMIN",
    is_active: true,
    must_change_password: false,
    created_at: "2026-10-01T10:00:00Z",
  },
  {
    id: 2,
    username: "paul",
    email: "paul@example.com",
    role: "ADVISOR",
    is_active: true,
    must_change_password: false,
    created_at: "2026-10-02T10:00:00Z",
  },
];

async function mockApi(
  page: Page,
  opts: { role?: string; mustChange?: boolean; calls?: unknown[] } = {},
) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me")
      body = {
        ...members[0],
        role: opts.role ?? "ADMIN",
        must_change_password: opts.mustChange ?? false,
      };
    else if (path === "/auth/password") {
      opts.calls?.push({ path, body: request.postDataJSON() });
      body = { access_token: "t2" };
    } else if (path === "/users" && method === "POST") {
      const sent = request.postDataJSON();
      opts.calls?.push({ path, body: sent });
      body = {
        id: 3,
        ...sent,
        is_active: true,
        must_change_password: true,
        created_at: "2026-10-23T10:00:00Z",
        temporary_password: "Abcd2345Efgh6789",
      };
      code = 201;
    } else if (path === "/users")
      body = { items: members, total: 2, limit: 200, offset: 0 };
    else if (path === "/users/2/reset-password") {
      opts.calls?.push({ path });
      body = { temporary_password: "Zyxw9876Vuts5432" };
    } else if (path === "/users/2" && method === "PATCH") {
      opts.calls?.push({ path, body: request.postDataJSON() });
      body = { ...members[1], ...request.postDataJSON() };
    } else if (path === "/todo")
      body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else if (path.startsWith("/dashboard")) body = {};
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("l'administrateur ajoute un conseiller et voit son mot de passe temporaire une fois", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await mockApi(page, { calls });
  await login(page);
  await page.goto("/team");
  const form = page.getByRole("region", { name: "Ajouter un membre" });
  await form.getByLabel("Nom d’utilisateur").fill("lea");
  await form.getByLabel("Email").fill("lea@example.com");
  await form.getByRole("button", { name: "Créer le membre" }).click();
  const secret = page.getByRole("status", { name: "Mot de passe temporaire" });
  await expect(secret.getByText("Abcd2345Efgh6789")).toBeVisible();
  expect(calls).toContainEqual({
    path: "/users",
    body: { username: "lea", email: "lea@example.com", role: "ADVISOR" },
  });
  await secret
    .getByRole("button", { name: "J’ai transmis le mot de passe" })
    .click();
  await expect(page.getByText("Abcd2345Efgh6789")).toHaveCount(0);
  await auditA11y(page, "équipe");
});

test("réinitialiser, changer le rôle et désactiver un membre", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await mockApi(page, { calls });
  await login(page);
  await page.goto("/team");
  const paul = page.getByRole("listitem", { name: "Membre paul" });
  const self = page.getByRole("listitem", { name: "Membre admin" });
  // Pas d'action sur son propre compte (rôle, désactivation, réinitialisation).
  await expect(self.getByLabel("Rôle de admin")).toBeDisabled();
  await expect(self.getByRole("button", { name: "Désactiver" })).toHaveCount(0);
  page.once("dialog", (d) => void d.accept());
  await paul
    .getByRole("button", { name: "Réinitialiser le mot de passe" })
    .click();
  await expect(page.getByText("Zyxw9876Vuts5432")).toBeVisible();
  await paul.getByLabel("Rôle de paul").selectOption("VIEWER");
  await paul.getByRole("button", { name: "Désactiver" }).click();
  await expect
    .poll(() => calls)
    .toEqual(
      expect.arrayContaining([
        { path: "/users/2/reset-password" },
        { path: "/users/2", body: { role: "VIEWER" } },
        { path: "/users/2", body: { is_active: false } },
      ]),
    );
});

test("mot de passe temporaire : redirection vers Mon compte puis changement", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await mockApi(page, { mustChange: true, calls });
  await login(page);
  await page.goto("/prospects");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(/mot de passe est temporaire/)).toBeVisible();
  const form = page.getByRole("region", { name: "Changer de mot de passe" });
  await form.getByLabel("Mot de passe actuel").fill("Abcd2345Efgh6789");
  await form
    .getByLabel("Nouveau mot de passe (12 caractères minimum)")
    .fill("mon-mot-de-passe-1");
  await form
    .getByLabel("Confirmer le nouveau mot de passe")
    .fill("mon-mot-de-passe-2");
  await expect(
    form.getByText("Les deux saisies sont différentes."),
  ).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Enregistrer le mot de passe" }),
  ).toBeDisabled();
  await form
    .getByLabel("Confirmer le nouveau mot de passe")
    .fill("mon-mot-de-passe-1");
  await form
    .getByRole("button", { name: "Enregistrer le mot de passe" })
    .click();
  await expect
    .poll(() => calls)
    .toContainEqual({
      path: "/auth/password",
      body: {
        current_password: "Abcd2345Efgh6789",
        new_password: "mon-mot-de-passe-1",
      },
    });
});

test("l'équipe est réservée aux administrateurs", async ({ page }) => {
  await mockApi(page, { role: "ADVISOR" });
  await login(page);
  await page.goto("/team");
  await expect(page.getByText("réservée aux administrateurs")).toBeVisible();
});
