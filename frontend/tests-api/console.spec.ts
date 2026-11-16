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

test("session : témoin HttpOnly, déconnexion révoquée côté serveur", async ({ page, context }) => {
  expect(PASSWORD, "E2E_ADMIN_PASSWORD manquant").not.toBe("");
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill(USER);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // AUDIT-SEC-004 : la session vit dans un témoin HttpOnly, invisible du JavaScript de la page.
  const session = (await context.cookies()).find((c) => c.name === "iagora_session");
  expect(session, "témoin de session absent").toBeDefined();
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Strict");
  expect(await page.evaluate(() => document.cookie)).not.toContain("iagora_session");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(session?.value ?? "-");

  // Une écriture authentifiée par le témoin sans l'en-tête anti-CSRF est refusée.
  const forged = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/prospects`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "csrf@demo.example.com" }),
    });
    return r.status;
  }, API);
  expect(forged).toBe(403);

  // Déconnexion par le menu : témoin effacé, retour à la connexion.
  await page.goto("/prospects");
  await page.getByRole("button", { name: /Menu du compte/ }).click();
  await page.getByRole("dialog", { name: "Menu du compte" }).getByRole("button", { name: "Déconnexion" }).click();
  await page.waitForURL(/\/login$/);
  expect((await context.cookies()).find((c) => c.name === "iagora_session")).toBeUndefined();

  // AUDIT-SEC-009 : le jeton copié avant la déconnexion est refusé par l'API.
  const ctx = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${session?.value}` } });
  expect((await ctx.get(`${API}/auth/me`)).status()).toBe(401);

  // Revenir sur une page protégée renvoie à la connexion, qui y ramènera (NAV-03).
  await page.goto("/prospects");
  await page.waitForURL(/\/login\?next=%2Fprospects$/);
});

test("import dans une campagne : colonne consentement et premiers contacts comptés par l'API", async ({ page }) => {
  expect(PASSWORD, "E2E_ADMIN_PASSWORD manquant").not.toBe("");
  const token = await apiToken();
  const ctx = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const stamp = Date.now();
  const created = await ctx.post(`${API}/campaigns`, {
    data: {
      name: `Salon e2e ${stamp}`,
      status: "active",
      target_codes: ["ebihar_students"],
      sources: [{ name: "Import CSV", type: "import", platform: "web" }],
    },
  });
  expect(created.status()).toBe(201);
  const campaign = await created.json();

  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill(USER);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto(`/campaigns/${campaign.id}?tab=prospects`);
  await page.getByRole("region", { name: "Premiers contacts" }).getByRole("link", { name: "Importer une liste" }).click();
  await expect(page.getByLabel("Source", { exact: true })).toHaveAttribute("data-value", String(campaign.sources[0].id));
  const csv = [
    "prénom;email;consentement",
    `Inès;ines.${stamp}@demo.example.com;oui`,
    `Jules;jules.${stamp}@demo.example.com;non`,
  ].join("\n");
  await page.getByLabel("Fichier CSV (2 Mo, 5000 lignes maximum)").setInputFiles({
    name: "salon.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  await expect(page.getByRole("region", { name: "Aperçu de l’import" })).toBeVisible();
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  const card = page.getByRole("region", { name: "Résultat de l’import" }).getByRole("region", { name: "Premiers contacts" });
  await expect(card.getByText("1 personne de la campagne peut recevoir un premier message de l’agent.")).toBeVisible();
  await expect(card.getByText("1 personne sans consentement (l’agent ne lui écrit pas)", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toHaveCount(0);
});
