import { expect, test, type Page } from "@playwright/test";

const member: Record<string, unknown> = {
  id: 11,
  conversion_stage: "qualified",
  total_score: 80,
  interest_score: 80,
  fit_score: 80,
  interest_status: "very_hot",
  assigned_advisor_id: null,
};
const prospect = {
  id: 1,
  first_name: "Alice",
  last_name: "Martin",
  email: "alice@example.com",
  phone: null,
  consent_status: "granted",
  consent_source: "formulaire",
  profile: {},
  created_at: "2026-10-01T10:00:00Z",
  campaigns: [
    member,
    { ...member, id: 12, conversion_stage: "contacted", total_score: 30 },
  ],
};
const pageOf = (items: unknown[], total = items.length, offset = 0) => ({
  items,
  total,
  limit: 25,
  offset,
});

async function mockApi(page: Page, role = "ADMIN", record = prospect) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown;
    let status = 200;
    if (path === "/auth/login") {
      const form = new URLSearchParams(route.request().postData() || "");
      status = form.get("password") === "valid-password" ? 200 : 401;
      body =
        status === 200
          ? { access_token: "test-session" }
          : { detail: "Identifiants invalides" };
    } else if (!route.request().headers().authorization) {
      status = 401;
      body = { detail: "Authentification requise" };
    } else if (path === "/auth/me")
      body = {
        id: 1,
        username: "conseiller",
        role,
        email: "advisor@example.com",
      };
    else if (path === "/campaigns")
      body = pageOf([{ id: 3, name: "eBIHAR", status: "active" }]);
    else if (path === "/prospects") {
      const q = url.searchParams.get("q");
      body =
        q && !"alice martin alice@example.com".includes(q.toLowerCase())
          ? pageOf([])
          : pageOf([record], 26, Number(url.searchParams.get("offset") || 0));
    } else if (path === "/prospects/1") body = record;
    else if (path === "/prospects/1/conversation")
      body = {
        id: "conversation-1",
        status: "open",
        channel: "email",
        messages: [],
        handoff: null,
      };
    else if (path.endsWith("/agent-runs")) body = [];
    else if (path.endsWith("/history"))
      body = { score_events: [], stage_events: [] };
    else {
      status = 404;
      body = { detail: "Introuvable" };
    }
    await route.fulfill({ status, json: body });
  });
}
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("conseiller");
  await page.getByLabel("Mot de passe").fill("valid-password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/prospects$/);
}

test("suivi : affectation administrative, étape justifiée et historique actualisé", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  let current = { ...member };
  const changes: unknown[] = [];
  await page.route("**/api/v1/advisors?**", (route) =>
    route.fulfill({ json: pageOf([{ id: 8, username: "Nadia" }]) }),
  );
  await page.route("**/api/v1/prospects/1", (route) =>
    route.fulfill({ json: { ...prospect, campaigns: [current] } }),
  );
  await page.route("**/api/v1/campaign-prospects/11", (route) => {
    const body = route.request().postDataJSON();
    changes.push(body);
    current = { ...current, ...body };
    return route.fulfill({ json: current });
  });
  await page.route("**/api/v1/campaign-prospects/11/history", (route) =>
    route.fulfill({
      json: {
        score_events: [],
        stage_events:
          current.conversion_stage === "converted"
            ? [
                {
                  id: 1,
                  from_stage: "qualified",
                  to_stage: "converted",
                  reason: "Inscription confirmée",
                  created_at: "2026-10-15T12:00:00Z",
                },
              ]
            : [],
      },
    }),
  );
  await login(page);
  await page.goto("/prospects/1");
  const follow = page.getByRole("region", {
    name: "Suivi du parcours 11",
    exact: true,
  });
  await follow.getByLabel("Conseiller responsable").selectOption("8");
  await follow
    .getByRole("button", { name: "Enregistrer l’affectation" })
    .click();
  await expect(
    follow.getByText("Nadia", { exact: true }).first(),
  ).toBeVisible();
  const stage = follow.getByRole("form", { name: "Étape du parcours 11" });
  await stage.getByLabel("Nouvelle étape").selectOption("converted");
  await expect(
    stage.getByRole("button", { name: "Enregistrer l’étape" }),
  ).toBeDisabled();
  await stage.getByLabel("Motif du changement").fill("Inscription confirmée");
  await stage.getByRole("button", { name: "Enregistrer l’étape" }).click();
  await expect(
    page.getByText("Converti", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("Historique du parcours 1", { exact: true }).click();
  await expect(page.getByText(/\(Inscription confirmée\)/)).toBeVisible();
  expect(changes).toEqual([
    { assigned_advisor_id: 8 },
    { conversion_stage: "converted", reason: "Inscription confirmée" },
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("suivi : conseiller sans droit d’affectation, échec visible sans faux succès", async ({
  page,
}) => {
  await mockApi(page, "ADVISOR");
  await page.route("**/api/v1/advisors?**", (route) =>
    route.fulfill({ json: pageOf([]) }),
  );
  await page.route("**/api/v1/campaign-prospects/11", (route) =>
    route.fulfill({ status: 409, json: { detail: "Modification refusée" } }),
  );
  await login(page);
  await page.goto("/prospects/1");
  await expect(page.getByLabel("Conseiller responsable")).toHaveCount(0);
  const stage = page.getByRole("form", {
    name: "Étape du parcours 11",
    exact: true,
  });
  await stage.getByLabel("Nouvelle étape").selectOption("converted");
  await stage.getByLabel("Motif du changement").fill("Justification conservée");
  await stage.getByRole("button", { name: "Enregistrer l’étape" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Modification refusée" }),
  ).toBeVisible();
  await expect(stage.getByLabel("Motif du changement")).toHaveValue(
    "Justification conservée",
  );
  await expect(page.getByText("Suivi enregistré.")).toHaveCount(0);
});

test("interactions : pagination, contenu canonique lié et lecture seule", async ({
  page,
}) => {
  await mockApi(page, "VIEWER");
  await page.route("**/api/v1/advisors?**", (route) =>
    route.fulfill({ json: pageOf([]) }),
  );
  await page.route("**/api/v1/prospects/1/interactions?**", (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    return route.fulfill({
      json: pageOf(
        [
          {
            id: offset + 1,
            type: "message",
            direction: "inbound",
            content: offset ? "Ancien formulaire" : null,
            conversation_ref: offset ? null : "older-conversation",
            created_at: "2026-10-01T10:00:00Z",
          },
        ],
        21,
        offset,
      ),
    });
  });
  await login(page);
  await page.goto("/prospects/1");
  const history = page.getByRole("region", {
    name: "Historique des interactions",
  });
  await expect(
    history.getByRole("link", { name: "Consulter l’échange" }),
  ).toHaveAttribute("href", "/conversations?id=older-conversation");
  await history.getByRole("button", { name: "Interactions suivantes" }).click();
  await expect(history.getByText("Ancien formulaire")).toBeVisible();
  await expect(page.getByLabel("Nouvelle étape")).toHaveCount(0);
  await expect(page.getByLabel("Conseiller responsable")).toHaveCount(0);
});

test("Mes prospects : filtre appliqué à la liste et à l’export", async ({
  page,
}) => {
  await mockApi(page, "ADVISOR");
  let exportUrl = "";
  await page.route("**/api/v1/prospects/export**", (route) => {
    exportUrl = route.request().url();
    return route.fulfill({
      body: "id;nom\n1;Alice",
      headers: { "content-type": "text/csv" },
    });
  });
  await login(page);
  const mine = page.waitForRequest(
    (r) => r.url().includes("/prospects?") && r.url().includes("advisor_id=1"),
  );
  await page
    .getByRole("button", { name: "Mes prospects", exact: true })
    .click();
  await mine;
  await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exporter en CSV (Excel)" }).click(),
  ]);
  expect(exportUrl).toContain("advisor_id=1");
  expect(exportUrl).toContain("demo=all");
});

test("connexion, pipeline multirattachement, table, fiche et déconnexion", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  await expect(
    page
      .getByRole("region", { name: /Pipeline des prospects/ })
      .getByText("Alice Martin"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page.getByRole("table").getByText("Très chaud", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Alice Martin" }).click();
  await expect(
    page.getByRole("heading", { name: "Alice Martin" }),
  ).toBeVisible();
  await expect(
    page.getByText("Historique du parcours 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Historique du parcours 2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lancer l'agent" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => localStorage.getItem("iagora.token")),
  ).toBeNull();
});

test("identifiants invalides sans ouvrir de session", async ({ page }) => {
  await mockApi(page);
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("conseiller");
  await page.getByLabel("Mot de passe").fill("incorrect");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Identifiants invalides" }),
  ).toHaveText("Identifiants invalides");
  await expect(page).toHaveURL(/\/login$/);
});

test("recherche, filtres transmis à l’API, pagination et état vide", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const request = page.waitForRequest(
    (r) =>
      r.url().includes("stage=qualified") && r.url().includes("campaign_id=3"),
  );
  await page.getByLabel("Étape", { exact: true }).selectOption("qualified");
  await page.getByLabel("Campagne", { exact: true }).selectOption("3");
  await request;
  const next = page.waitForRequest((r) => r.url().includes("offset=25"));
  await page.getByRole("button", { name: "Suivant" }).click();
  await next;
  await page
    .getByRole("searchbox", { name: "Rechercher", exact: true })
    .fill("inexistant");
  await expect(
    page.getByRole("heading", { name: "Aucun prospect ne correspond" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les filtres" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Rechercher", exact: true }),
  ).toHaveValue("");
  await expect(page.getByText("Alice Martin").first()).toBeVisible();
});

test("observateur : consultation seule sur la fiche", async ({ page }) => {
  await mockApi(page, "VIEWER");
  await login(page);
  await page.goto("/prospects/1");
  await expect(
    page.getByRole("button", { name: "Lancer l'agent" }),
  ).toBeDisabled();
  await expect(page.getByText("Observateur", { exact: true })).toBeVisible();
});

test("session expirée : retour à la connexion", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.route("**/api/v1/prospects/1", (route) =>
    route.fulfill({ status: 401, json: { detail: "Session expirée" } }),
  );
  await page.goto("/prospects/1");
  await expect(page).toHaveURL(/\/login$/);
});

test("panne de l’API : erreur et nouvelle tentative", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.route("**/api/v1/prospects?**", (route) => route.abort());
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Serveur injoignable" }),
  ).toContainText("Serveur injoignable");
  await page.unroute("**/api/v1/prospects?**");
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByText("Alice Martin").first()).toBeVisible();
});

test("mobile : menu repliable et absence de débordement de page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await login(page);
  const menu = page.locator('button[aria-controls="app-navigation"]');
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("prospect sans campagne : visible en première colonne", async ({
  page,
}) => {
  await mockApi(page, "ADMIN", { ...prospect, campaigns: [] });
  await login(page);
  const column = page.getByRole("region", {
    name: "Sans campagne",
    exact: true,
  });
  await expect(column.getByText("Alice Martin")).toBeVisible();
});

test("désinscription : sortie du pipeline et lancement bloqué", async ({
  page,
}) => {
  await mockApi(page, "ADMIN", { ...prospect, consent_status: "opted_out" });
  await login(page);
  await expect(
    page
      .getByRole("region", { name: "Sorties", exact: true })
      .getByText("Alice Martin"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: /Pipeline des prospects/ })
      .getByText("Alice Martin"),
  ).toHaveCount(1);
  await page.goto("/prospects/1");
  await expect(
    page.getByRole("button", { name: "Lancer l'agent" }),
  ).toBeDisabled();
});

test("échec de chargement du compte : réessayer sans rester bloqué", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/v1/auth/me", (route) => route.abort());
  await login(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Serveur injoignable" }),
  ).toBeVisible();
  await page.unroute("**/api/v1/auth/me");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(
    page.getByRole("heading", { name: "Prospects", exact: true }),
  ).toBeVisible();
});

test("fiche : désinscription confirmée, campagne liée et lien vers la conversation", async ({
  page,
}) => {
  await mockApi(page, "ADVISOR", {
    ...prospect,
    campaigns: [{ ...member, campaign_id: 3, campaign_name: "eBIHAR" }],
  });
  const posts: { path: string; body: unknown }[] = [];
  await page.route("**/api/v1/prospects/1/opt-out", async (route) => {
    posts.push({
      path: "/prospects/1/opt-out",
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      json: { ...prospect, consent_status: "opted_out", campaigns: [] },
    });
  });
  await login(page);
  await page.goto("/prospects/1");
  await expect(page.getByRole("link", { name: "eBIHAR" })).toHaveAttribute(
    "href",
    "/campaigns/3",
  );
  await expect(
    page.getByRole("link", { name: "Ouvrir dans Conversations" }),
  ).toHaveAttribute("href", "/conversations?id=conversation-1");
  await expect(page.getByText("Ouverte").first()).toBeVisible();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page
    .getByRole("button", { name: "Enregistrer une désinscription" })
    .click();
  expect(posts).toHaveLength(0);
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Enregistrer une désinscription" })
    .click();
  await expect(page.getByText("Désinscription enregistrée.")).toBeVisible();
  expect(posts[0].body).toMatchObject({ channel: "email" });
});

test("fiche : un observateur ne voit aucune action de consentement", async ({
  page,
}) => {
  await mockApi(page, "VIEWER");
  await login(page);
  await page.goto("/prospects/1");
  await expect(
    page.getByRole("heading", { name: "Alice Martin" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /désinscription/ }),
  ).toHaveCount(0);
});

test("filtres programme, intérêt, canal et consentement transmis à l'API", async ({
  page,
}) => {
  await mockApi(page);
  const queries: string[] = [];
  await page.route("**/api/v1/prospects?**", async (route) => {
    queries.push(new URL(route.request().url()).search);
    await route.fallback();
  });
  await login(page);
  await page.getByLabel("Programme").selectOption("ebihar_students");
  await page.getByLabel("Intérêt").selectOption("very_hot");
  await page.getByLabel("Canal", { exact: true }).selectOption("email");
  await page.getByLabel("Consentement").selectOption("granted");
  await expect
    .poll(() =>
      queries.some(
        (q) =>
          q.includes("target_code=ebihar_students") &&
          q.includes("level=very_hot") &&
          q.includes("channel=email") &&
          q.includes("consent_status=granted"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Réinitialiser" }).click();
  await expect(page.getByLabel("Programme")).toHaveValue("");
});

test("export CSV : téléchargement avec les filtres, absent pour un observateur", async ({
  page,
}) => {
  await mockApi(page);
  let exportUrl = "";
  await page.route("**/api/v1/prospects/export**", async (route) => {
    exportUrl = route.request().url();
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="prospects.csv"',
      },
      body: "﻿id;prénom\r\n1;Alice\r\n",
    });
  });
  await login(page);
  await page.getByLabel("Programme").selectOption("ebihar_students");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exporter en CSV (Excel)" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("prospects.csv");
  expect(exportUrl).toContain("target_code=ebihar_students");
});

test("export CSV : un observateur ne voit pas le bouton", async ({ page }) => {
  await mockApi(page, "VIEWER");
  await login(page);
  await expect(
    page.getByRole("button", { name: "Exporter en CSV (Excel)" }),
  ).toHaveCount(0);
});

test("attribution : choisir explicitement campagne et source, puis quitter la file", async ({
  page,
}) => {
  await mockApi(page, "ADVISOR", { ...prospect, campaigns: [] });
  let assigned = false;
  let body: unknown;
  await page.route("**/api/v1/campaigns?**", (route) =>
    route.fulfill({
      json: pageOf([
        {
          id: 3,
          name: "Campagne active",
          status: "active",
          targets: [],
          sources: [{ id: 7, name: "Boîte IONOS" }],
        },
      ]),
    }),
  );
  await page.route("**/api/v1/prospects/1/campaigns", async (route) => {
    body = route.request().postDataJSON();
    assigned = true;
    await route.fulfill({
      json: {
        ...prospect,
        campaigns: [
          {
            ...member,
            campaign_id: 3,
            campaign_name: "Campagne active",
            source_name: "Boîte IONOS",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/prospects/1", (route) =>
    route.fulfill({
      json: assigned
        ? {
            ...prospect,
            current_membership_id: 11,
            campaigns: [
              {
                ...member,
                campaign_id: 3,
                campaign_name: "Campagne active",
                source_name: "Boîte IONOS",
              },
            ],
          }
        : { ...prospect, campaigns: [] },
    }),
  );
  await login(page);
  await page.goto("/prospects/1");
  const form = page.getByRole("form", { name: "Attribution commerciale" });
  await expect(
    form.getByRole("button", { name: "Attribuer et démarrer le suivi" }),
  ).toBeDisabled();
  await form.getByLabel("Campagne d’attribution").selectOption("3");
  await expect(
    form.getByRole("button", { name: "Attribuer et démarrer le suivi" }),
  ).toBeDisabled();
  await form.getByLabel("Source d’attribution").selectOption("7");
  await form
    .getByRole("button", { name: "Attribuer et démarrer le suivi" })
    .click();
  await expect(form).toHaveCount(0);
  expect(body).toEqual({ campaign_id: 3, source_id: 7 });
  await expect(page.getByText("Source : Boîte IONOS")).toBeVisible();
  await expect(
    page.getByText("Contexte de l’agent", { exact: true }),
  ).toBeVisible();
});

test("observateur : file À attribuer accessible, attribution interdite", async ({
  page,
}) => {
  await mockApi(page, "VIEWER", { ...prospect, campaigns: [] });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await login(page);
  await page.goto("/prospects");
  await page.getByRole("button", { name: /^À attribuer/ }).click();
  await expect
    .poll(() =>
      requests.some(
        (u) => u.includes("pending_campaign=true") && u.includes("limit=25"),
      ),
    )
    .toBe(true);
  await page.goto("/prospects/1");
  await expect(page.getByText(/À attribuer : choisissez/)).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Attribution commerciale" }),
  ).toHaveCount(0);
});
