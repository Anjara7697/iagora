import { expect, request, test } from "@playwright/test";

// Parcours de bout en bout contre le vrai backend (AUDIT-QA-001) : la console et l'API réelles
// doivent se comprendre. Données fictives uniquement (base de test de la CI).
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8000/api/v1";
const USER = process.env.E2E_ADMIN_USER ?? "e2e-admin";
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";

async function apiToken(): Promise<string> {
  const ctx = await request.newContext();
  const r = await ctx.post(`${API}/auth/login`, { form: { username: USER, password: PASSWORD } });
  expect(r.ok(), `connexion à l'API : ${r.status()}`).toBeTruthy();
  return (await r.json()).access_token;
}

test("connexion réelle, prospect créé par l'API et lu par la console, écrans sans erreur", async ({ page }) => {
  expect(PASSWORD, "E2E_ADMIN_PASSWORD manquant").not.toBe("");
  const token = await apiToken();
  const ctx = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const created = await ctx.post(`${API}/prospects`, {
    data: {
      first_name: "Élise",
      last_name: "Contrat",
      email: `elise.contrat.${Date.now()}@demo.example.com`,
      phone: "06 12 34 56 78",
      channel: "email",
      message: "Bonjour, je voudrais des informations.",
    },
  });
  expect(created.status()).toBe(201);
  const prospectId = (await created.json()).prospect.id;

  // Vraie connexion par l'écran : jeton, redirection, menu.
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill(USER);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // La fiche affiche ce que l'API a enregistré (téléphone au format international).
  await page.goto(`/prospects/${prospectId}`);
  await expect(page.getByRole("heading", { name: /Élise Contrat/ })).toBeVisible();
  await expect(page.getByText("+33612345678")).toBeVisible();

  // Chaque écran se charge sans état d'erreur d'API (pas de bouton « Réessayer »).
  for (const path of [
    "/",
    "/todo",
    "/conversations",
    "/prospects",
    "/campaigns",
    "/appointments",
    "/dashboard",
    "/analytics",
    "/agent",
    "/knowledge",
    "/integrations",
    "/settings",
    "/team",
    "/account",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Réessayer" }), `erreur d'API sur ${path}`).toHaveCount(0);
    await expect(page.getByText("Erreur interne du serveur"), `erreur 500 sur ${path}`).toHaveCount(0);
  }
});
