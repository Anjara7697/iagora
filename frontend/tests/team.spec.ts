import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";
import { choose } from "./select";

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
  opts: { role?: string; mustChange?: boolean; calls?: unknown[]; failUsers?: boolean } = {},
) {
  // Copie par test : une modification (PATCH) se relit au rechargement, comme sur l'API.
  const team = members.map((m) => ({ ...m }));
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
    } else if (path === "/users" && opts.failUsers) {
      code = 503;
      body = { detail: "Base indisponible" };
    } else if (path === "/users")
      body = { items: team, total: team.length, limit: 200, offset: 0 };
    else if (path === "/users/2/reset-password") {
      opts.calls?.push({ path });
      body = { temporary_password: "Zyxw9876Vuts5432" };
    } else if (path === "/users/2" && method === "PATCH") {
      opts.calls?.push({ path, body: request.postDataJSON() });
      team[1] = { ...team[1], ...request.postDataJSON() };
      body = team[1];
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
  // Attendre la fin de la connexion (jeton enregistré, redirection) avant de naviguer.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("l'administrateur ajoute un conseiller et voit son mot de passe temporaire une fois", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await mockApi(page, { calls });
  await login(page);
  await page.goto("/team");
  await expect(page.getByRole("status").filter({ hasText: "2 membres · 2 actifs" })).toBeVisible();
  // Règle 1 : la création s'ouvre dans un panneau latéral.
  await page.getByRole("button", { name: "Ajouter un membre" }).first().click();
  const form = page.getByRole("dialog", { name: "Ajouter un membre" });
  await form.getByLabel("Nom d’utilisateur").fill("lea");
  await form.getByLabel("Email").fill("lea@example.com");
  await auditA11y(page, "équipe (ajout)");
  await form.getByRole("button", { name: "Créer le membre" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText("Membre ajouté")).toBeVisible();
  const secret = page.getByRole("status", { name: "Mot de passe temporaire" });
  await expect(secret.getByText("Abcd2345Efgh6789")).toBeVisible();
  expect(calls).toContainEqual({
    path: "/users",
    body: { username: "lea", email: "lea@example.com", role: "ADVISOR" },
  });
  await secret.getByRole("button", { name: "J’ai transmis le mot de passe" }).click();
  await expect(page.getByText("Abcd2345Efgh6789")).toHaveCount(0);
  await auditA11y(page, "équipe");
});

test("fiche d'un membre : rôle, réinitialisation et désactivation confirmées", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await mockApi(page, { calls });
  await login(page);
  await page.goto("/team");
  await page.getByRole("row", { name: /paul/ }).click();
  await expect(page).toHaveURL(/member=2/);
  const panel = page.getByRole("dialog", { name: "paul" });
  await choose(panel.getByLabel("Rôle"), "VIEWER");
  await panel.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Membre mis à jour")).toBeVisible();

  await panel.getByRole("button", { name: "Réinitialiser le mot de passe" }).click();
  const confirmReset = page.getByRole("alertdialog", { name: "Réinitialiser le mot de passe de paul ?" });
  await expect(confirmReset).toContainText("Ses sessions ouvertes seront fermées");
  await confirmReset.getByRole("button", { name: "Réinitialiser" }).click();
  // Le mot de passe s'affiche dans le panneau ouvert, une seule fois.
  await expect(panel.getByText("Zyxw9876Vuts5432")).toBeVisible();

  await panel.getByRole("button", { name: "Désactiver" }).click();
  const confirmOff = page.getByRole("alertdialog", { name: "Désactiver paul ?" });
  await confirmOff.getByRole("button", { name: "Annuler" }).click();
  expect(calls).not.toContainEqual({ path: "/users/2", body: { is_active: false } });
  await panel.getByRole("button", { name: "Désactiver" }).click();
  await page.getByRole("alertdialog", { name: "Désactiver paul ?" }).getByRole("button", { name: "Désactiver" }).click();
  await expect
    .poll(() => calls)
    .toEqual(
      expect.arrayContaining([
        { path: "/users/2", body: { role: "VIEWER" } },
        { path: "/users/2/reset-password" },
        { path: "/users/2", body: { is_active: false } },
      ]),
    );
  await panel.getByRole("button", { name: "Fermer" }).click();
  await expect(page).not.toHaveURL(/member=/);
  // Panneau fermé : le mot de passe reste visible sur la page jusqu'à confirmation.
  await expect(page.getByRole("status", { name: "Mot de passe temporaire" })).toContainText("Zyxw9876Vuts5432");
});

test("son propre compte : actions impossibles visibles avec leur raison", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.goto("/team?member=1");
  const panel = page.getByRole("dialog", { name: "admin" });
  await expect(panel.getByText("Vous ne pouvez pas modifier votre propre rôle.")).toBeVisible();
  const off = panel.getByRole("button", { name: "Désactiver" });
  await expect(off).toHaveAttribute("aria-disabled", "true");
  await off.focus();
  await expect(page.getByRole("tooltip")).toContainText("Vous ne pouvez pas désactiver votre propre compte.");
  await expect(panel.getByRole("button", { name: "Réinitialiser le mot de passe" })).toHaveAttribute("aria-disabled", "true");
  await auditA11y(page, "équipe (son compte)");
});

test("recherche et rôle dans l'adresse ; aucune correspondance", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.goto("/team");
  await page.getByRole("button", { name: "Conseiller", exact: true }).click();
  await expect(page).toHaveURL(/role=ADVISOR/);
  await expect(page.getByRole("status").filter({ hasText: "1 membre sur 2" })).toBeVisible();
  await page.getByLabel("Rechercher un membre").fill("inconnu");
  await expect(page.getByText("Aucun membre ne correspond")).toBeVisible();
  await page.getByRole("button", { name: "Afficher tous les membres" }).click();
  await expect(page.getByRole("row", { name: /paul/ })).toBeVisible();
  await expect(page).toHaveURL(/\/team$/);
});

test("fermer une fiche modifiée demande confirmation", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.goto("/team?member=2");
  const panel = page.getByRole("dialog", { name: "paul" });
  await panel.getByLabel("Email").fill("paul.martin@example.com");
  await panel.getByRole("button", { name: "Fermer" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Abandonner les modifications ?" });
  await confirm.getByRole("button", { name: "Continuer la saisie" }).click();
  await expect(panel.getByLabel("Email")).toHaveValue("paul.martin@example.com");
  await panel.getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("alertdialog", { name: "Abandonner les modifications ?" }).getByRole("button", { name: "Abandonner" }).click();
  await expect(panel).toHaveCount(0);
});

test("équipe indisponible : message clair et nouvel essai", async ({ page }) => {
  await mockApi(page, { failUsers: true });
  await login(page);
  await page.goto("/team");
  await expect(page.getByRole("alert").filter({ hasText: "Chargement de l’équipe impossible" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
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
