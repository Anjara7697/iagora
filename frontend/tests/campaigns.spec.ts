import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";
import { choose } from "./select";

const campaign = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Recrutement eBIHAR 2026",
  description: "Campagne de rentrée",
  status: "draft",
  start_date: "2026-09-01T00:00:00Z",
  end_date: null,
  targets: [{ id: 1, code: "ebihar_students", name: "Étudiants eBIHAR" }],
  sources: [
    {
      id: 10,
      name: "LinkedIn Ads",
      type: "ads",
      platform: "linkedin",
      external_id: null,
    },
    {
      id: 11,
      name: "Landing",
      type: "landing_page",
      platform: "web",
      external_id: null,
    },
  ],
  ...over,
});
const stats = {
  prospects: 12,
  average_score: 31.5,
  by_stage: {
    new: 5,
    in_conversation: 3,
    meeting_scheduled: 2,
    converted: 1,
    lost: 1,
  },
  by_level: { cold: 6, warm: 3, hot: 2, very_hot: 1 },
  by_source: [
    { source_id: 10, name: "LinkedIn Ads", platform: "linkedin", prospects: 9 },
    { source_id: 11, name: "Landing", platform: "web", prospects: 3 },
  ],
  meetings: 2,
  converted: 1,
};
const TARGET_LIST = [
  { id: 1, code: "ebihar_students", name: "Étudiants eBIHAR" },
  { id: 2, code: "compagnons_pros", name: "Professionnels Les Compagnons" },
];

test("sources : distinguer LinkedIn manuel, formulaire connecté et import avec destination", async ({ page }) => {
  await mockApi(page);
  await login(page, "/campaigns/1?tab=sources");
  const linkedin = page.getByRole("region", { name: "Réception · LinkedIn Ads", exact: true });
  await expect(linkedin.getByText("LinkedIn : réception manuelle", { exact: true })).toBeVisible();
  await expect(linkedin.getByRole("link", { name: "Importer dans cette source" })).toHaveAttribute("href", "/prospects/import?campaign=1&source=10");
  const form = page.getByRole("region", { name: "Réception · Landing", exact: true });
  await expect(form.getByRole("link", { name: "Brancher le formulaire" })).toHaveAttribute("href", "/integrations?c=leads&campaign=1&source=11");
  await expect(form.getByRole("link", { name: "Voir les contacts reçus" })).toHaveAttribute("href", "/prospects?campaign=1&source=11");
});

type Calls = {
  requests: { method: string; path: string; body: unknown }[];
  queries: string[];
};

async function mockApi(
  page: Page,
  opts: { role?: string; removeConflict?: boolean } = {},
) {
  const calls: Calls = { requests: [], queries: [] };
  let current = campaign();
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me")
      body = {
        id: 1,
        username: "admin",
        role: opts.role ?? "ADMIN",
        email: "a@example.com",
      };
    else if (path === "/campaigns" && method === "GET") {
      calls.queries.push(url.search);
      // Filtre de statut et pagination comme l'API (limit / offset, total).
      const status = url.searchParams.get("status");
      const all = [current].filter((c) => !status || c.status === status);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      body = { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
    } else if (path === "/campaigns" && method === "POST") {
      calls.requests.push({ method, path, body: request.postDataJSON() });
      code = 201;
      body = campaign({
        id: 7,
        name: "Nouvelle",
        targets: [{ id: 2, code: "compagnons_pros", name: "Professionnels Les Compagnons" }],
        sources: [
          { id: 21, name: "Meta Lead Ads", type: "ads", platform: "meta", external_id: "123456" },
          { id: 22, name: "Formulaire du site", type: "form", platform: "web", external_id: null },
        ],
      });
    } else if (path === "/integrations/meta" && method === "GET") {
      body = {
        configured: true,
        enabled: true,
        app_id: "app-1",
        api_version: "v21.0",
        app_secret_set: true,
        page_access_token_set: true,
        verify_token_set: true,
        mappings: [],
        webhook_path: "/api/v1/webhooks/meta",
        last_event_at: null,
        last_success_at: null,
        last_error: null,
        received: 0,
        processed: 0,
        failed: 0,
      };
    } else if (path === "/integrations/meta" && method === "PUT") {
      calls.requests.push({ method, path, body: request.postDataJSON() });
      body = { configured: true };
    } else if (path === "/integrations/tokens") {
      body = [];
    } else if (path === "/integrations/email") {
      body = { configured: false, enabled: false, send_enabled: false, sender: null, imap_host: "", smtp_host: "", sandbox_recipients: [], last_run_at: null };
    } else if (path === "/campaigns/overview")
      body = [
        {
          campaign_id: 1,
          prospects: 12,
          hot: 3,
          meetings: 2,
          qualified: 5,
          converted: 1,
        },
      ];
    else if (path === "/campaigns/1/stats") body = stats;
    else if (path === "/campaigns/1" && method === "GET") body = current;
    else if (path === "/campaigns/1" && method === "PATCH") {
      const patch = request.postDataJSON() as Record<string, unknown>;
      calls.requests.push({ method, path, body: patch });
      current = {
        ...current,
        ...(patch.status ? { status: String(patch.status) } : {}),
        ...(patch.name ? { name: String(patch.name) } : {}),
      };
      body = current;
    } else if (path === "/campaigns/1/sources" && method === "POST") {
      const added = request.postDataJSON() as { name: string; type: string; platform: string; external_id: string | null };
      calls.requests.push({ method, path, body: added });
      code = 201;
      current = { ...current, sources: [...current.sources, { id: 12, ...added, external_id: null }] };
      body = current;
    } else if (
      path.startsWith("/campaigns/1/sources/") &&
      method === "DELETE"
    ) {
      calls.requests.push({ method, path, body: null });
      if (opts.removeConflict) {
        code = 409;
        body = {
          detail:
            "9 prospect(s) proviennent de cette source : elle ne peut pas être retirée",
        };
      } else body = current;
    } else if (path === "/targets") body = TARGET_LIST;
    else if (path === "/advisors")
      body = {
        items: [{ id: 9, username: "Nadia" }],
        total: 1,
        limit: 50,
        offset: 0,
      };
    else if (path === "/prospects") {
      calls.queries.push(url.search);
      body = { items: [], total: 0, limit: 25, offset: 0 };
    } else if (path === "/todo")
      body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
  return calls;
}

test("responsable : choix explicite du sort des prospects et mise à jour de la campagne", async ({
  page,
}) => {
  await mockApi(page);
  let current = campaign();
  let payload: unknown;
  await page.route("**/api/v1/campaigns/1", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/api/v1/campaigns/1/responsible", (route) => {
    payload = route.request().postDataJSON();
    current = campaign({
      responsible_advisor_id: 9,
      responsible_advisor_name: "Nadia",
    });
    return route.fulfill({ json: current });
  });
  await login(page, "/campaigns/1");
  await page.getByRole("tab", { name: "Réglages" }).click();
  const form = page.getByRole("form", { name: "Affectation de la campagne" });
  await choose(form.getByLabel("Conseiller responsable de la campagne"), "9");
  await expect(
    form.getByRole("button", { name: "Enregistrer le responsable" }),
  ).toBeDisabled();
  await choose(form.getByLabel("Prospects déjà présents"), "keep");
  await expect(
    form.getByText(/Les affectations actuelles deviennent des exceptions/),
  ).toBeVisible();
  await form
    .getByRole("button", { name: "Enregistrer le responsable" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Responsable de campagne" })
      .getByText("Nadia", { exact: true })
      .first(),
  ).toBeVisible();
  expect(payload).toEqual({ advisor_id: 9, existing_prospects: "keep" });
  await auditA11y(page, "campagnes");
});

test("responsable : erreur conservée, aucun contrôle d'affectation pour un conseiller", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/v1/campaigns/1/responsible", (route) =>
    route.fulfill({ status: 422, json: { detail: "Compte indisponible" } }),
  );
  await login(page, "/campaigns/1");
  await page.getByRole("tab", { name: "Réglages" }).click();
  const form = page.getByRole("form", { name: "Affectation de la campagne" });
  await choose(form.getByLabel("Conseiller responsable de la campagne"), "9");
  await choose(form.getByLabel("Prospects déjà présents"), "transfer_inherited");
  await form
    .getByRole("button", { name: "Enregistrer le responsable" })
    .click();
  await expect(form.getByRole("alert")).toHaveText("Compte indisponible");
  await expect(
    form.getByLabel("Conseiller responsable de la campagne"),
  ).toHaveAttribute("data-value", "9");
  await mockApi(page, { role: "ADVISOR" });
  await page.reload();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await expect(
    page.getByRole("heading", { name: "Responsable de campagne" }),
  ).toBeVisible();
  await expect(form).toHaveCount(0);
});

test("Mes campagnes : filtre du responsable envoyé avec le statut", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await login(page);
  await page
    .getByRole("button", { name: "Mes campagnes", exact: true })
    .click();
  await page.getByRole("button", { name: "Actives", exact: true }).click();
  await expect
    .poll(() =>
      calls.queries.some(
        (q) => q.includes("advisor_id=1") && q.includes("status=active"),
      ),
    )
    .toBe(true);
});

async function login(page: Page, then = "/campaigns") {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto(then);
}

test("liste des campagnes avec chiffres clés, programmes et statut", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await login(page);
  const card = page.getByRole("row", { name: /Recrutement eBIHAR 2026/ });
  await expect(card.getByText("Brouillon")).toBeVisible();
  await expect(card.getByText("eBIHAR — étudiants")).toBeVisible();
  await expect(card.getByText("2 sources")).toBeVisible();
  const figures = card.getByRole("gridcell");
  await expect(figures.nth(2)).toHaveText("12");
  await expect(figures.nth(3)).toHaveText("5");
  await expect(figures.nth(4)).toHaveText("1");
  const strip = page.getByRole("region", { name: "Chiffres clés" });
  await expect(strip.getByText("0 / 1")).toBeVisible();
  await expect(strip.getByText("42 %")).toBeVisible();
  // Compteur à droite de la barre de filtres.
  await expect(page.getByRole("status").filter({ hasText: /^1 campagne$/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Nouvelle campagne" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Actives", exact: true }).click();
  await expect
    .poll(() => calls.queries.some((q) => q.includes("status=active")))
    .toBe(true);
});

test("un conseiller consulte sans pouvoir créer ni modifier", async ({
  page,
}) => {
  await mockApi(page, { role: "ADVISOR" });
  await login(page);
  await expect(
    page.getByRole("link", { name: "Nouvelle campagne" }),
  ).toHaveCount(0);
  await page.getByRole("row", { name: /Recrutement eBIHAR 2026/ }).click();
  await expect(
    page.getByRole("heading", { name: "Recrutement eBIHAR 2026" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Modifier la campagne" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retirer" })).toHaveCount(0);
});

test("création en trois étapes : informations, période et ciblage, sources envoyés à l'API", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await login(page, "/campaigns/new");
  // Étape 1 : informations
  await expect(page.getByRole("navigation", { name: "Étapes de création" })).toBeVisible();
  await page.getByLabel("Nom de la campagne").fill("Rentrée 2027");
  // Le statut ne se choisit plus à la création : la campagne naît en brouillon.
  await expect(page.getByLabel("Statut")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuer" }).click();
  // Étape 2 : période et programmes
  await page.getByRole("spinbutton").first().click();
  await page.keyboard.type("0109202630092026");
  await page.getByLabel("Compagnons", { exact: false }).press("Space");
  await page.getByRole("button", { name: "Continuer" }).click();
  // Étape 3 : connecteurs de sources, récapitulatif puis création
  await expect(page.getByRole("region", { name: "Connecteurs disponibles" }).getByText("Connectée")).toBeVisible();
  await page.getByRole("button", { name: "Ajouter Meta Lead Ads" }).click();
  await expect(page.getByLabel("Source 1 : Meta Lead Ads")).toContainText("À finaliser");
  await page.getByLabel("Identifiant du formulaire Meta 1").fill("123456");
  await expect(page.getByLabel("Source 1 : Meta Lead Ads")).toContainText("Formulaire associé");
  await page.getByRole("button", { name: "Ajouter Formulaire du site ou n8n" }).click();
  await expect(page.getByLabel("Source 2 : Formulaire du site ou n8n")).toContainText("Jeton à créer");
  await expect(page.getByRole("button", { name: "Ajouter LinkedIn Lead Gen" })).toBeDisabled();
  const recap = page.getByLabel("Récapitulatif");
  await expect(recap).toContainText("Rentrée 2027");
  await expect(recap).toContainText("01/09/2026 → 30/09/2026");
  await expect(recap).toContainText("Brouillon");
  await page.getByRole("button", { name: "Créer la campagne" }).click();
  // La fiche est compilée au premier accès par le serveur de développement.
  await expect(page).toHaveURL(/\/campaigns\/7$/, { timeout: 30_000 });
  await expect
    .poll(() => calls.requests)
    .toContainEqual({
      method: "POST",
      path: "/campaigns",
      body: {
        name: "Rentrée 2027",
        description: null,
        status: "draft",
        start_date: "2026-09-01T00:00:00Z",
        end_date: "2026-09-30T00:00:00Z",
        target_codes: ["compagnons_pros"],
        sources: [
          { name: "Meta Lead Ads", type: "ads", platform: "meta", external_id: "123456" },
          { name: "Formulaire du site", type: "form", platform: "web", external_id: null },
        ],
      },
    });
  // Le formulaire Meta saisi est associé à la campagne créée (source et programme unique).
  await expect
    .poll(() => calls.requests.find((r) => r.method === "PUT" && r.path === "/integrations/meta")?.body)
    .toMatchObject({
      mappings: [
        { form_id: "123456", campaign_id: 7, source_id: 21, target_code: "compagnons_pros", enabled: true },
      ],
      app_secret: null,
    });
});

test("création : le nom est requis pour continuer et le retour conserve la saisie", async ({ page }) => {
  await mockApi(page);
  await login(page, "/campaigns/new");
  const next = page.getByRole("button", { name: "Continuer" });
  await expect(next).toBeDisabled();
  await page.getByLabel("Nom de la campagne").fill("Campagne test");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByLabel("Nom de la campagne")).toHaveCount(0);
  await page.getByRole("button", { name: "Retour" }).click();
  await expect(page.getByLabel("Nom de la campagne")).toHaveValue("Campagne test");
  await expect(page.getByRole("button", { name: /Informations/ })).toHaveAttribute("aria-current", "step");
});

test("fiche : entonnoir, niveaux, sources avec effectifs et lien vers les prospects", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await login(page, "/campaigns/1");
  await expect(
    page.getByRole("heading", { name: "Recrutement eBIHAR 2026" }),
  ).toBeVisible();
  const funnel = page.getByRole("region", { name: "Entonnoir" });
  await expect(funnel.getByText("À qualifier")).toBeVisible();
  await expect(funnel.getByText("Rendez-vous")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Niveaux d'intérêt" })
      .getByText("Très chaud"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Sources" }).click();
  const sources = page.getByRole("region", { name: "Sources" });
  await expect(
    sources.getByRole("row", { name: /LinkedIn Ads/ }).getByRole("gridcell", { name: "9", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir dans Prospects" }).click();
  await expect(page).toHaveURL(/\/prospects\?campaign=1$/);
  await expect
    .poll(() => calls.queries.some((q) => q.includes("campaign_id=1")))
    .toBe(true);
});

test("administrateur : activer, modifier les programmes, ajouter et retirer une source", async ({
  page,
}) => {
  const calls = await mockApi(page, { removeConflict: true });
  await login(page, "/campaigns/1");
  await page.getByRole("button", { name: "Activer" }).click();
  const activate = page.getByRole("alertdialog");
  await expect(activate.getByText("Activer la campagne ?")).toBeVisible();
  await activate.getByRole("button", { name: "Activer" }).click();
  // Règle des parcours : toute écriture réussie est confirmée par un Toast.
  await expect(page.getByText("Campagne activée")).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect
    .poll(() => calls.requests)
    .toContainEqual({
      method: "PATCH",
      path: "/campaigns/1",
      body: { status: "active" },
    });

  await page.getByRole("button", { name: "Modifier la campagne" }).click();
  await page.getByLabel("Compagnons", { exact: false }).press("Space");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect
    .poll(() =>
      calls.requests.find(
        (r) =>
          r.method === "PATCH" &&
          (r.body as { target_codes?: string[] }).target_codes,
      ),
    )
    .toBeTruthy();
  const patch = calls.requests.find(
    (r) => (r.body as { target_codes?: string[] }).target_codes,
  )!;
  expect((patch.body as { target_codes: string[] }).target_codes).toEqual([
    "ebihar_students",
    "compagnons_pros",
  ]);

  await page.getByRole("tab", { name: "Sources" }).click();
  await page.getByRole("button", { name: "Ajouter Formulaire du site ou n8n" }).click();
  await page.getByLabel("Nom de la nouvelle source").fill("Webinaire d'octobre");
  await page.getByRole("button", { name: "Ajouter à la campagne" }).click();
  await expect
    .poll(() =>
      calls.requests.some(
        (r) => r.path === "/campaigns/1/sources" && r.method === "POST",
      ),
    )
    .toBe(true);
  await expect(page.getByText("Source ajoutée")).toBeVisible();

  // Source avec prospects : retrait impossible, raison en infobulle, aucun appel.
  const linkedin = page.getByRole("row", { name: /LinkedIn Ads/ });
  await expect(linkedin.getByRole("button", { name: "Retirer", exact: true })).toBeDisabled();
  await linkedin.getByRole("button", { name: "Retirer", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("9 prospects proviennent de cette source");
  // Source sans prospect : confirmation d'abord ; Annuler n'appelle rien.
  const webinar = page.getByRole("row", { name: /Webinaire d'octobre/ });
  await webinar.getByRole("button", { name: "Retirer", exact: true }).click();
  const remove = page.getByRole("alertdialog");
  await expect(remove.getByText("Retirer « Webinaire d'octobre » ?")).toBeVisible();
  await remove.getByRole("button", { name: "Annuler" }).click();
  await expect(remove).toHaveCount(0);
  expect(calls.requests.some((r) => r.method === "DELETE")).toBe(false);
  // Confirmé : appel envoyé ; un refus du serveur (chiffres périmés) reste affiché.
  await webinar.getByRole("button", { name: "Retirer", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retirer", exact: true }).click();
  await expect.poll(() => calls.requests.some((r) => r.method === "DELETE" && r.path === "/campaigns/1/sources/12")).toBe(true);
  await expect(page.getByRole("alert").filter({ hasText: "ne peut pas être retirée" })).toBeVisible();
});

test("fiche : les prospects de la campagne sont listés sous les sources", async ({
  page,
}) => {
  await mockApi(page);
  const queries: string[] = [];
  await page.route("**/api/v1/prospects?**", async (route) => {
    queries.push(new URL(route.request().url()).search);
    await route.fulfill({
      json: {
        items: [
          {
            id: 5,
            first_name: "Alice",
            last_name: "Martin",
            email: "alice@acme-corp.com",
            phone: null,
            profile: {},
            consent_status: "granted",
            consent_source: null,
            opted_out_at: null,
            created_at: "2026-10-01T10:00:00Z",
            campaigns: [
              {
                id: 99,
                campaign_id: 2,
                campaign_source_id: 10,
                conversion_stage: "lost",
                total_score: 0,
                last_seen_at: "2026-10-15T12:00:00Z",
              },
              {
                id: 1,
                campaign_id: 1,
                campaign_source_id: 10,
                conversion_stage: "in_conversation",
                interest_status: "hot",
                interest_score: 40,
                fit_score: 30,
                total_score: 70,
                assigned_advisor_id: null,
              },
            ],
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      },
    });
  });
  await login(page, "/campaigns/1");
  await page.getByRole("tab", { name: "Prospects" }).click();
  const section = page.getByRole("region", {
    name: "Prospects de la campagne",
  });
  const row = section.getByRole("row", { name: /Alice Martin/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("alice@acme-corp.com")).toBeVisible();
  await expect(row.getByText("En conversation")).toBeVisible();
  await expect(row.getByText("Perdu")).toHaveCount(0);
  await choose(section.getByLabel("Étape"), "qualified");
  await expect
    .poll(() => queries.some((q) => q.includes("stage=qualified")))
    .toBe(true);
  expect(queries.some((q) => q.includes("campaign_id=1"))).toBe(true);
  await expect(page).toHaveURL(/\/campaigns\/1\?tab=prospects&stage=qualified$/);
  await row.click();
  await expect(page).toHaveURL(/\/prospects\/5\?from=/, { timeout: 15000 });
  // Le retour ramène à la campagne, sur l'onglet et l'étape quittés.
  await page.getByRole("link", { name: "← Retour à la campagne" }).click();
  await expect(page).toHaveURL(/\/campaigns\/1\?tab=prospects&stage=qualified$/, { timeout: 15000 });
  await expect(page.getByRole("tab", { name: "Prospects" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Prospects de la campagne" }).getByLabel("Étape")).toContainText("Qualifié");
});

test("désactiver une campagne demande confirmation", async ({ page }) => {
  const calls = await mockApi(page);
  await login(page, "/campaigns/1");
  // Activer demande aussi confirmation ; Annuler n'envoie rien.
  await page.getByRole("button", { name: "Activer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Annuler" }).click();
  expect(calls.requests.some((r) => (r.body as { status?: string })?.status === "active")).toBe(false);
  await page.getByRole("button", { name: "Activer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Activer" }).click();
  await expect(page.getByRole("button", { name: "Mettre en pause" })).toBeVisible();
  await page.getByRole("button", { name: "Mettre en pause" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Mettre la campagne en pause ?")).toBeVisible();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    calls.requests.filter(
      (r) => (r.body as { status?: string })?.status === "inactive",
    ),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Mettre en pause" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Mettre en pause" }).click();
  await expect
    .poll(() =>
      calls.requests.some(
        (r) => (r.body as { status?: string })?.status === "inactive",
      ),
    )
    .toBe(true);
});

test("menu en quatre groupes, écrans à venir regroupés et recherche globale", async ({
  page,
}) => {
  await mockApi(page);
  await login(page, "/campaigns");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  for (const group of ["Travail", "Pilotage", "Intelligence", "Administration"])
    await expect(nav.getByText(group, { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Campagnes" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Écrans prévus : regroupés dans une ligne « À venir » repliée, sans lien.
  const upcoming = nav.getByText("À venir");
  await expect(upcoming).toBeVisible();
  await expect(nav.getByText("Analyses", { exact: true })).toBeHidden();
  await upcoming.click();
  await expect(nav.getByText("Analyses", { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Analyses" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Tableau de bord" })).toHaveAttribute("href", "/dashboard");
  // Recherche unique de la barre du haut : la palette, qui cherche aussi les prospects.
  await page.getByRole("button", { name: /Rechercher un prospect, une page/ }).click();
  await page.getByRole("dialog", { name: "Recherche rapide" }).getByRole("searchbox").fill("alice");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/prospects\?q=alice$/);
});

test("création : Annuler sans saisie quitte, avec saisie demande confirmation", async ({ page }) => {
  await mockApi(page);
  await login(page, "/campaigns/new");
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page).toHaveURL(/\/campaigns$/, { timeout: 15_000 });

  await page.goto("/campaigns/new");
  await page.getByLabel("Nom de la campagne").fill("Rentrée 2027");
  await page.getByRole("button", { name: "Annuler" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Abandonner les modifications ?")).toBeVisible();
  await dialog.getByRole("button", { name: "Continuer la saisie" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/campaigns\/new$/);
  await expect(page.getByLabel("Nom de la campagne")).toHaveValue("Rentrée 2027");

  await page.getByRole("button", { name: "Annuler" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Abandonner" }).click();
  await expect(page).toHaveURL(/\/campaigns$/, { timeout: 15_000 });
});

test("création : une erreur de l'API s'affiche en alerte", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/v1/campaigns", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 422, json: { detail: "Programme inconnu" } })
      : route.fallback(),
  );
  await login(page, "/campaigns/new");
  await page.getByLabel("Nom de la campagne").fill("Rentrée 2027");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Créer la campagne" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Programme inconnu" });
  await expect(alert).toBeVisible();
  await expect(alert).toBeInViewport();
  await expect(page).toHaveURL(/\/campaigns\/new$/);
});

test("fiche : fermer le panneau de modification avec une saisie demande confirmation", async ({ page }) => {
  const calls = await mockApi(page);
  await login(page, "/campaigns/1");
  const drawer = page.getByRole("dialog", { name: "Modifier la campagne" });
  // Sans modification, Échap ferme directement.
  await page.getByRole("button", { name: "Modifier la campagne" }).click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  await page.getByRole("button", { name: "Modifier la campagne" }).click();
  await drawer.getByLabel("Nom de la campagne").fill("Nouveau nom");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("Abandonner les modifications ?")).toBeVisible();
  await confirm.getByRole("button", { name: "Continuer la saisie" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(drawer.getByLabel("Nom de la campagne")).toHaveValue("Nouveau nom");

  await drawer.getByRole("button", { name: "Annuler" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Abandonner" }).click();
  await expect(drawer).toHaveCount(0);
  expect(calls.requests.some((r) => r.method === "PATCH" && (r.body as { name?: string }).name === "Nouveau nom")).toBe(false);
});

test("liste : filtres dans l'URL, conservés au retour depuis une fiche", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.getByRole("button", { name: "Brouillons", exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\?status=draft$/);
  await page.getByRole("row", { name: /Recrutement eBIHAR 2026/ }).click();
  await expect(page).toHaveURL(/\/campaigns\/1\?from=%2Fcampaigns%3Fstatus%3Ddraft$/, { timeout: 15_000 });
  // Lien « ← Campagnes » : retour à la liste filtrée.
  await page.getByRole("link", { name: "← Campagnes" }).click();
  await expect(page).toHaveURL(/\/campaigns\?status=draft$/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Brouillons", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Retour du navigateur : même résultat, et l'onglet de la fiche est conservé.
  await page.getByRole("row", { name: /Recrutement eBIHAR 2026/ }).click();
  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(page).toHaveURL(/\/campaigns\/1\?tab=sources&from=/);
  await page.goBack();
  await expect(page).toHaveURL(/\/campaigns\?status=draft$/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Brouillons", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await expect(page.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
});

test("fiche : un onglet s'ouvre par lien direct, une valeur inconnue revient à la vue d'ensemble", async ({ page }) => {
  await mockApi(page);
  await login(page, "/campaigns/1?tab=settings");
  await expect(page.getByRole("tab", { name: "Réglages" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/campaigns/1?tab=inconnu&from=https%3A%2F%2Fexemple.test");
  await expect(page.getByRole("tab", { name: "Vue d'ensemble" })).toHaveAttribute("aria-selected", "true");
  // Une URL de retour étrangère n'est jamais suivie.
  await expect(page.getByRole("link", { name: "← Campagnes" })).toHaveAttribute("href", "/campaigns");
});

test("liste : pagination côté serveur, page dans l'URL et chiffres clés au-delà d'une page", async ({ page }) => {
  await mockApi(page);
  const many = Array.from({ length: 8 }, (_, i) =>
    campaign({ id: 100 + i, name: `Campagne ${i + 1}`, status: i < 3 ? "active" : "draft" }),
  );
  const queries: string[] = [];
  await page.route("**/api/v1/campaigns?**", (route) => {
    const url = new URL(route.request().url());
    queries.push(url.search);
    const status = url.searchParams.get("status");
    const all = many.filter((c) => !status || c.status === status);
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return route.fulfill({ json: { items: all.slice(offset, offset + limit), total: all.length, limit, offset } });
  });
  await login(page);
  const strip = page.getByRole("region", { name: "Chiffres clés" });
  await expect(strip.getByText("3 / 8")).toBeVisible();
  await expect(strip.getByText("5 brouillon(s)")).toBeVisible();
  await expect(page.getByRole("row", { name: /Campagne 1\b/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Campagne 7/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\?page=2$/);
  await expect(page.getByRole("row", { name: /Campagne 7/ })).toBeVisible();
  expect(queries.some((q) => q.includes("limit=6") && q.includes("offset=6"))).toBe(true);
  // Une page hors limites revient à la dernière page.
  await page.goto("/campaigns?page=9");
  await expect(page).toHaveURL(/\/campaigns\?page=2$/, { timeout: 15_000 });
});

test("liste : premier usage, filtre sans résultat, chargement et erreur", async ({ page }) => {
  await mockApi(page);
  // Filtre sans résultat (la campagne simulée est un brouillon) : action pour tout réafficher.
  await login(page, "/campaigns?status=inactive");
  await expect(page.getByText("Aucune campagne ne correspond à ces filtres")).toBeVisible();
  await expect(page.getByText("Filtres actifs : En pause.")).toBeVisible();
  await page.getByRole("button", { name: "Afficher toutes les campagnes" }).click();
  await expect(page).toHaveURL(/\/campaigns$/);
  await expect(page.getByRole("row", { name: /Recrutement eBIHAR 2026/ })).toBeVisible();

  // Premier usage : bouton de création dans l'état vide.
  await page.route("**/api/v1/campaigns?**", (route) => route.fulfill({ json: { items: [], total: 0, limit: 6, offset: 0 } }));
  await page.reload();
  await expect(page.getByText("Aucune campagne pour l’instant")).toBeVisible();
  await expect(page.getByRole("link", { name: "Nouvelle campagne" })).toHaveCount(2);

  // Erreur : message explicite, chiffres en « — », nouvelle tentative.
  await page.route("**/api/v1/campaigns?**", (route) => route.fulfill({ status: 500, json: { detail: "Erreur interne" } }));
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Impossible de charger les campagnes : Erreur interne" })).toBeVisible();
  // Même panne : une seule alerte (son « Réessayer » recharge aussi les chiffres).
  await expect(page.getByRole("alert").filter({ hasText: "Chiffres clés indisponibles" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Chiffres clés" }).getByText("—")).toHaveCount(4);
});

test("statut expliqué, période ouverte lisible et ouverture d'une campagne au clavier", async ({ page }) => {
  await mockApi(page);
  await login(page);
  // Clavier : la ligne prend le focus et Entrée ouvre la fiche.
  const row = page.getByRole("row", { name: /Recrutement eBIHAR 2026/ });
  await expect(row).toContainText("Depuis le 01/09/2026");
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/campaigns\/1$/, { timeout: 15_000 });
  await expect(page.getByText("Ne reçoit pas encore de prospects : activez-la pour démarrer.")).toBeVisible();
  await expect(page.getByText("Depuis le 01/09/2026")).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicateurs de la campagne" }).getByText("sur 100")).toBeVisible();
  // Mise en pause : libellé « En pause » et bouton « Réactiver ».
  await page.getByRole("button", { name: "Activer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Activer" }).click();
  await page.getByRole("button", { name: "Mettre en pause" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Mettre en pause" }).click();
  await expect(page.getByText("En pause", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Réactiver" })).toBeVisible();
});

test("accessibilité : fiche, onglets, panneau, confirmations, création et états vides", async ({ page }) => {
  test.setTimeout(90_000);
  await mockApi(page);
  await login(page, "/campaigns?status=inactive");
  await expect(page.getByText("Aucune campagne ne correspond à ces filtres")).toBeVisible();
  await auditA11y(page, "liste filtrée sans résultat");

  await page.goto("/campaigns/1");
  await expect(page.getByRole("heading", { name: "Recrutement eBIHAR 2026" })).toBeVisible();
  await auditA11y(page, "fiche : vue d'ensemble");
  for (const tab of ["Prospects", "Sources", "Réglages"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await auditA11y(page, `fiche : onglet ${tab}`);
  }

  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await auditA11y(page, "confirmation d'activation");
  await page.getByRole("alertdialog").getByRole("button", { name: "Annuler" }).click();

  await page.getByRole("button", { name: "Modifier la campagne" }).click();
  const drawer = page.getByRole("dialog", { name: "Modifier la campagne" });
  await drawer.getByLabel("Nom de la campagne").fill("Nouveau nom");
  await auditA11y(page, "panneau de modification");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await auditA11y(page, "confirmation d'abandon");
  await page.getByRole("alertdialog").getByRole("button", { name: "Abandonner" }).click();

  await page.goto("/campaigns/new");
  await page.getByLabel("Nom de la campagne").fill("Rentrée 2027");
  await auditA11y(page, "création : informations");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByLabel("Récapitulatif")).toBeVisible();
  await auditA11y(page, "création : sources et récapitulatif");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/1?tab=sources");
  await expect(page.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
  await auditA11y(page, "fiche mobile : sources");
});

test("menu : intitulés en français, réduit à ses icônes avec infobulles et choix mémorisé", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, "/campaigns");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link", { name: "Base de connaissances" })).toBeVisible();
  // Tout le menu tient dans un écran de portable, Paramètres compris.
  await expect(nav.getByRole("link", { name: "Paramètres" })).toBeInViewport();
  await page.getByRole("button", { name: "Réduire le menu" }).click();
  await expect(page.getByRole("button", { name: "Agrandir le menu" })).toHaveAttribute("aria-expanded", "false");
  // Réduit : le lien garde son nom et l'intitulé apparaît en infobulle.
  const campaigns = nav.getByRole("link", { name: "Campagnes" });
  await expect(campaigns).toHaveAttribute("aria-current", "page");
  await campaigns.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Campagnes");
  // Choix mémorisé au rechargement.
  await page.reload();
  await expect(page.getByRole("button", { name: "Agrandir le menu" })).toBeVisible();
  await page.getByRole("button", { name: "Agrandir le menu" }).click();
  await expect(page.getByRole("button", { name: "Réduire le menu" })).toBeVisible();
});

test("menu mobile : Drawer HeroUI qui garde le focus et se ferme", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "/campaigns");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  // Le focus reste dans le menu tant qu'il est ouvert.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // Bouton Fermer, puis navigation qui referme le menu.
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Fermer le menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Base de connaissances" }).click();
  await expect(page).toHaveURL(/\/knowledge$/, { timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
});

test("accessibilité : barre et menu (complet, réduit, menu du compte, palette, mobile, thème sombre)", async ({ page }) => {
  test.setTimeout(120_000);
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, "/campaigns");
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  await auditA11y(page, "barre et menu complet");
  await page.getByRole("button", { name: /Menu du compte/ }).click();
  await expect(page.getByRole("dialog", { name: "Menu du compte" })).toBeVisible();
  await auditA11y(page, "menu du compte (agent, thème)");
  // Thème sombre : mêmes écrans, contrastes du jeu de couleurs sombre.
  await page.getByRole("dialog", { name: "Menu du compte" }).getByRole("radio", { name: "Sombre" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await auditA11y(page, "menu du compte en thème sombre");
  await page.keyboard.press("Escape");
  await auditA11y(page, "liste des campagnes en thème sombre");
  await page.goto("/campaigns/1");
  await expect(page.getByRole("heading", { name: "Recrutement eBIHAR 2026" })).toBeVisible();
  await auditA11y(page, "fiche campagne en thème sombre");
  await page.goto("/campaigns");
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  await page.getByRole("button", { name: /Rechercher un prospect, une page/ }).click();
  await expect(page.getByRole("dialog", { name: "Recherche rapide" })).toBeVisible();
  await auditA11y(page, "palette de recherche");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Réduire le menu" }).click();
  await expect(page.getByRole("button", { name: "Agrandir le menu" })).toBeVisible();
  await auditA11y(page, "menu réduit");
  await page.getByRole("button", { name: "Agrandir le menu" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await auditA11y(page, "menu mobile");
});

test("menu du compte : thème clair, sombre ou système, conservé au rechargement", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApi(page);
  await page.emulateMedia({ colorScheme: "light" });
  await login(page, "/campaigns");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Menu du compte/ }).click();
  const menu = page.getByRole("dialog", { name: "Menu du compte" });
  // Sélection unique : le ToggleButtonGroup HeroUI est un groupe de boutons radio.
  const theme = menu.getByRole("radiogroup", { name: "Thème" });
  await expect(theme.getByRole("radio", { name: "Système" })).toHaveAttribute("aria-checked", "true");
  await theme.getByRole("radio", { name: "Sombre" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  // « Système » suit le réglage de l'appareil, y compris quand il change.
  await page.getByRole("button", { name: /Menu du compte/ }).click();
  await page.getByRole("dialog", { name: "Menu du compte" }).getByRole("radio", { name: "Système" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("barre : recherche à gauche, menu du compte au clavier", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, "/campaigns");
  const search = page.getByRole("button", { name: /Rechercher un prospect, une page/ });
  const account = page.getByRole("button", { name: /Menu du compte/ });
  const [s, a] = [await search.boundingBox(), await account.boundingBox()];
  expect(s!.x).toBeLessThan(400);
  expect(s!.x).toBeLessThan(a!.x);
  // Clavier : Entrée ouvre le menu, Tab parcourt ses entrées, Échap le ferme et rend le focus au bouton.
  await account.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "Menu du compte" });
  await expect(menu).toBeVisible();
  const names: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    names.push(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute("aria-label") || (document.activeElement as HTMLElement).innerText.trim()));
  }
  // Le groupe de thème est un seul arrêt de tabulation ; les flèches déplacent le focus d'un choix à l'autre. Le focus
  // reste dans le menu (retour à « Mon compte » après « Déconnexion »).
  expect(names).toEqual(["Mon compte", "Arrêt d’urgence", "Clair", "Déconnexion", "Mon compte"]);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  // Flèches pour se déplacer, Espace pour choisir.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(account).toBeFocused();
});
