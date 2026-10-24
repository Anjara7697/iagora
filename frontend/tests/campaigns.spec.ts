import { expect, test, type Page } from "@playwright/test";

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
      body = { items: [current], total: 1, limit: 100, offset: 0 };
    } else if (path === "/campaigns" && method === "POST") {
      calls.requests.push({ method, path, body: request.postDataJSON() });
      code = 201;
      body = campaign({ id: 7, name: "Nouvelle" });
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
      calls.requests.push({ method, path, body: request.postDataJSON() });
      code = 201;
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
  const form = page.getByRole("form", { name: "Affectation de la campagne" });
  await form
    .getByLabel("Conseiller responsable de la campagne")
    .selectOption("9");
  await expect(
    form.getByRole("button", { name: "Enregistrer le responsable" }),
  ).toBeDisabled();
  await form.getByLabel("Prospects déjà présents").selectOption("keep");
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
});

test("responsable : erreur conservée, aucun contrôle d'affectation pour un conseiller", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/v1/campaigns/1/responsible", (route) =>
    route.fulfill({ status: 422, json: { detail: "Compte indisponible" } }),
  );
  await login(page, "/campaigns/1");
  const form = page.getByRole("form", { name: "Affectation de la campagne" });
  await form
    .getByLabel("Conseiller responsable de la campagne")
    .selectOption("9");
  await form
    .getByLabel("Prospects déjà présents")
    .selectOption("transfer_inherited");
  await form
    .getByRole("button", { name: "Enregistrer le responsable" })
    .click();
  await expect(form.getByRole("alert")).toHaveText("Compte indisponible");
  await expect(
    form.getByLabel("Conseiller responsable de la campagne"),
  ).toHaveValue("9");
  await mockApi(page, { role: "ADVISOR" });
  await page.reload();
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
  const card = page.getByRole("link", { name: /Recrutement eBIHAR 2026/ });
  await expect(card.getByText("Brouillon")).toBeVisible();
  await expect(card.getByText("eBIHAR — étudiants")).toBeVisible();
  await expect(card.getByText("2 sources")).toBeVisible();
  await expect(card.getByText("12 · 5 · 1")).toBeVisible();
  const strip = page.getByRole("region", { name: "Chiffres clés" });
  await expect(strip.getByText("0 / 1")).toBeVisible();
  await expect(strip.getByText("42 %")).toBeVisible();
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
  await page.getByRole("link", { name: /Recrutement eBIHAR 2026/ }).click();
  await expect(
    page.getByRole("heading", { name: "Recrutement eBIHAR 2026" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Modifier la campagne" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retirer" })).toHaveCount(0);
});

test("création : formulaire, programmes et sources envoyés à l'API", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await login(page, "/campaigns/new");
  await page.getByLabel("Nom de la campagne").fill("Rentrée 2027");
  await page.getByLabel("Statut").selectOption("active");
  await page.getByLabel("Compagnons", { exact: false }).check();
  await page.getByRole("button", { name: "Ajouter une source" }).click();
  await page.getByLabel("Nom de la source 1").fill("Webinaire");
  await page.getByLabel("Type de la source 1").selectOption("webinar");
  await page.getByLabel("Plateforme de la source 1").selectOption("web");
  await page.getByRole("button", { name: "Créer la campagne" }).click();
  await expect(page).toHaveURL(/\/campaigns\/7$/);
  await expect
    .poll(() => calls.requests)
    .toContainEqual({
      method: "POST",
      path: "/campaigns",
      body: {
        name: "Rentrée 2027",
        description: null,
        status: "active",
        start_date: null,
        end_date: null,
        target_codes: ["compagnons_pros"],
        sources: [
          {
            name: "Webinaire",
            type: "webinar",
            platform: "web",
            external_id: null,
          },
        ],
      },
    });
});

test("dates incohérentes : création bloquée", async ({ page }) => {
  await mockApi(page);
  await login(page, "/campaigns/new");
  await page.getByLabel("Nom de la campagne").fill("X");
  await page.getByLabel("Date de début").fill("2026-10-10");
  await page.getByLabel("Date de fin").fill("2026-09-01");
  await expect(
    page.getByText("La date de fin doit être postérieure"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Créer la campagne" }),
  ).toBeDisabled();
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
  const sources = page.getByRole("region", { name: "Sources" });
  await expect(
    sources.getByRole("row", { name: /LinkedIn Ads.*9/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Voir les prospects" }).click();
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
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect
    .poll(() => calls.requests)
    .toContainEqual({
      method: "PATCH",
      path: "/campaigns/1",
      body: { status: "active" },
    });

  await page.getByRole("button", { name: "Modifier la campagne" }).click();
  await page.getByLabel("Compagnons", { exact: false }).check();
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

  await page
    .getByLabel("Nom de la nouvelle source")
    .fill("Webinaire d'octobre");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect
    .poll(() =>
      calls.requests.some(
        (r) => r.path === "/campaigns/1/sources" && r.method === "POST",
      ),
    )
    .toBe(true);

  await page
    .getByRole("row", { name: /LinkedIn Ads/ })
    .getByRole("button", { name: "Retirer" })
    .click();
  await expect(
    page.getByText("9 prospect(s) proviennent de cette source"),
  ).toBeVisible();
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
  const section = page.getByRole("region", {
    name: "Prospects de la campagne",
  });
  const row = section.getByRole("row", { name: /Alice Martin/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("alice@acme-corp.com")).toBeVisible();
  await expect(row.getByText("En conversation")).toBeVisible();
  await expect(row.getByText("Perdu")).toHaveCount(0);
  await section.getByLabel("Étape").selectOption("qualified");
  await expect
    .poll(() => queries.some((q) => q.includes("stage=qualified")))
    .toBe(true);
  expect(queries.some((q) => q.includes("campaign_id=1"))).toBe(true);
  await row.getByRole("link", { name: "Alice Martin" }).click();
  await expect(page).toHaveURL(/\/prospects\/5$/, { timeout: 15000 });
});

test("désactiver une campagne demande confirmation", async ({ page }) => {
  const calls = await mockApi(page);
  await login(page, "/campaigns/1");
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByRole("button", { name: "Désactiver" })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Désactiver" }).click();
  expect(
    calls.requests.filter(
      (r) => (r.body as { status?: string })?.status === "inactive",
    ),
  ).toHaveLength(0);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Désactiver" }).click();
  await expect
    .poll(() =>
      calls.requests.some(
        (r) => (r.body as { status?: string })?.status === "inactive",
      ),
    )
    .toBe(true);
});

test("l'en-tête porte le titre de chaque écran", async ({ page }) => {
  await mockApi(page);
  await login(page, "/campaigns/new");
  await expect(page.locator("header strong")).toHaveText("Nouvelle campagne");
  await page.goto("/campaigns/1");
  await expect(page.locator("header strong")).toHaveText("Campagne");
  await page.goto("/integrations");
  await expect(page.locator("header strong")).toHaveText("Intégrations");
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
  await expect(nav.getByText("Dashboard", { exact: true })).toBeHidden();
  await upcoming.click();
  await expect(nav.getByText("Dashboard", { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await page.getByLabel("Rechercher un prospect").fill("alice");
  await page.getByLabel("Rechercher un prospect").press("Enter");
  await expect(page).toHaveURL(/\/prospects\?q=alice$/);
});
