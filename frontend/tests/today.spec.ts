import { expect, test, type Page } from "@playwright/test";

const summary = {
  agent_mode: "assisted",
  hot_prospects: [
    {
      id: 5,
      name: "Sophie Merlin",
      email: "sophie@acme-corp.com",
      stage: "qualified",
      level: "very_hot",
      total_score: 88,
      campaign_id: 3,
      campaign_name: "eBIHAR",
    },
  ],
  activity: {
    hours: 24,
    prospects_analysed: 24,
    drafts_generated: 3,
    sent_after_validation: 2,
    sent_without_validation: 0,
    escalations: 1,
    errors: 1,
  },
  follow_ups: [
    {
      id: 1,
      prospect_id: 7,
      prospect_name: "Marie Dupont",
      scheduled_at: "2026-10-27T09:00:00Z",
      reason: "Relance J+7",
    },
  ],
  follow_ups_total: 3,
  funnel_days: 30,
  funnel: { new: 20, in_conversation: 10, qualified: 4, converted: 1 },
  leads: 35,
};

async function mockApi(
  page: Page,
  opts: { fail?: boolean; incident?: boolean; role?: string } = {},
) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me")
      body = {
        id: 1,
        username: "nadia.cisse",
        role: opts.role ?? "ADMIN",
        email: "n@example.com",
      };
    else if (path === "/dashboard/summary") {
      if (opts.fail) {
        code = 500;
        body = { detail: "Erreur interne du serveur" };
      } else body = summary;
    } else if (path === "/todo") {
      const kind = url.searchParams.get("kind");
      body =
        kind === "incident"
          ? {
              items: opts.incident
                ? [
                    {
                      id: "incident:1",
                      kind: "incident",
                      title: "Webhook du formulaire en échec depuis 09:04",
                      detail: "Aucun lead reçu depuis 6 h.",
                    },
                  ]
                : [],
              total: opts.incident ? 1 : 0,
              limit: 1,
              offset: 0,
              counts: {},
            }
          : {
              items: [],
              total: 5,
              limit: 1,
              offset: 0,
              counts: { validation: 2, escalation: 1, kb_gap: 1, incident: 1 },
            };
    } else if (path === "/agent/mode") body = { mode: "assisted" };
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
}

async function open(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("nadia");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto("/");
}

test("accueil : une famille ouvre la file sur son filtre réel", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  const request = page.waitForRequest(
    (r) =>
      new URL(r.url()).pathname.endsWith("/todo") &&
      new URL(r.url()).searchParams.get("kind") === "validation",
  );
  await page.getByRole("link", { name: /^Validations/ }).click();
  await request;
  await expect(page).toHaveURL(/\/todo\?kind=validation$/);
  await expect(
    page.getByRole("button", { name: "Brouillons à valider (2)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Tout (5)", exact: true }).click();
  await expect(page).toHaveURL(/\/todo$/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Tout (5)", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("accueil : salutation, familles à traiter, signaux forts, activité, relances et entonnoir", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Bonjour nadia" }),
  ).toBeVisible();
  await expect(page.getByText("5 éléments vous attendent")).toBeVisible();
  await expect(
    page.getByText("l’agent a préparé 3 brouillons en 24 h"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Validations/ })).toContainText(
    "2",
  );
  await expect(page.getByRole("link", { name: /Escalades/ })).toContainText(
    "1",
  );
  const hot = page.getByRole("region", { name: "Prospects à fort signal" });
  await expect(
    hot.getByRole("link", { name: /Sophie Merlin/ }),
  ).toHaveAttribute("href", "/prospects/5");
  await expect(hot.getByText("Très chaud")).toBeVisible();
  const activity = page.getByRole("region", { name: "Activité de l'agent" });
  await expect(activity.getByText("prospects analysés")).toBeVisible();
  await expect(
    activity.getByText("L’agent n’a envoyé aucun message sans validation."),
  ).toBeVisible();
  const follow = page.getByRole("region", { name: "Relances programmées" });
  await expect(follow.getByText("Marie Dupont")).toBeVisible();
  await expect(
    follow.getByText("+ 2 autre(s) relance(s) programmée(s)."),
  ).toBeVisible();
  const funnel = page.getByRole("region", { name: "Entonnoir" });
  await expect(funnel.getByText("35 prospects arrivés")).toBeVisible();
});

test("accueil : incident en bandeau avec lien de diagnostic", async ({
  page,
}) => {
  await mockApi(page, { incident: true });
  await open(page);
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Webhook du formulaire" });
  await expect(alert).toBeVisible();
  await expect(
    alert.getByRole("link", { name: "Diagnostiquer" }),
  ).toHaveAttribute("href", /\/todo\?id=incident/);
});

test("accueil : panne de l'API, message clair et nouvelle tentative", async ({
  page,
}) => {
  await mockApi(page, { fail: true });
  await open(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Erreur interne" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
});
