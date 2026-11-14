import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";
import { choose } from "./select";

const member: Record<string, unknown> = {
  id: 11,
  campaign_id: 3,
  source_id: 7,
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
  // Session simulée comme le témoin HttpOnly de l'API : ouverte à la connexion, fermée à la
  // déconnexion, jamais lisible par la page.
  let signedIn = false;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const request = route.request();
    let body: unknown;
    let status = 200;
    if (path === "/auth/login") {
      const form = new URLSearchParams(request.postData() || "");
      status = form.get("password") === "valid-password" ? 200 : 401;
      signedIn = status === 200;
      body =
        status === 200
          ? { access_token: "test-session" }
          : { detail: "Identifiants invalides" };
    } else if (path === "/auth/logout") {
      signedIn = false;
      await route.fulfill({ status: 204, body: "" });
      return;
    } else if (!signedIn) {
      status = 401;
      body = { detail: "Authentification requise" };
    } else if (request.method() !== "GET" && !request.headers()["x-iagora-csrf"]) {
      status = 403;
      body = { detail: "Requête refusée (origine)" };
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
/** Connexion depuis une page de connexion qui ramène à la liste des prospects (`?next=`). */
async function login(page: Page) {
  await page.goto("/login?next=%2Fprospects");
  await page.getByLabel("Email ou nom").fill("conseiller");
  await page.getByLabel("Mot de passe").fill("valid-password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/prospects$/);
}

/** Choisit un filtre dans le panneau « Filtres » (ouvert puis refermé). */
async function selectFilter(page: Page, label: string, value: string) {
  const panel = page.getByRole("dialog", { name: "Filtres" });
  await page.getByRole("button", { name: /^Filtres/ }).click();
  await panel.getByLabel(label, { exact: true }).click();
  await page.locator(`[role="option"][data-value="${value}"]`).click();
  await expect(page.getByRole("listbox", { name: label })).toHaveCount(0);
  await panel.getByRole("button", { name: /^Afficher/ }).click();
  await expect(panel).toHaveCount(0);
}
/** Puce d'un filtre actif, sous la barre. */
const activeFilter = (page: Page, title: string) => page.getByRole("button", { name: `Retirer le filtre ${title}` });

test("campagne et source : seuls les parcours filtrés apparaissent, export identique", async ({
  page,
}) => {
  await mockApi(page, "ADVISOR", {
    ...prospect,
    campaigns: [
      { ...member, id: 99, campaign_id: 99, conversion_stage: "converted" },
      member,
      { ...member, id: 12, source_id: 8, conversion_stage: "contacted" },
    ],
  });
  await page.route("**/api/v1/campaigns?**", (route) =>
    route.fulfill({
      json: pageOf([
        {
          id: 3,
          name: "Campagne choisie",
          sources: [
            { id: 7, name: "Formulaire" },
            { id: 8, name: "Webinaire" },
          ],
        },
      ]),
    }),
  );
  let exportUrl = "";
  await page.route("**/api/v1/prospects/export**", (route) => {
    exportUrl = route.request().url();
    return route.fulfill({
      body: "id;nom\n1;Alice",
      headers: { "content-type": "text/csv" },
    });
  });
  await login(page);
  await selectFilter(page, "Campagne", "3");
  await selectFilter(page, "Source", "7");
  const board = page.getByRole("region", { name: /Pipeline des prospects/ });
  await expect(board.getByText("Alice Martin", { exact: true })).toHaveCount(1);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  const row = page.getByRole("row", { name: /Alice Martin/ });
  await expect(row.getByText("Qualifié", { exact: true })).toBeVisible();
  await expect(row.getByText("Contacté", { exact: true })).toHaveCount(0);
  await expect(row.getByText("Converti", { exact: true })).toHaveCount(0);
  await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exporter en CSV (Excel)" }).click(),
  ]);
  expect(exportUrl).toContain("source_id=7");
  expect(exportUrl).toContain("campaign_id=3");
  await page
    .getByRole("button", { name: "Réinitialiser", exact: true })
    .click();
  await expect(activeFilter(page, "Source")).toHaveCount(0);
  await expect(activeFilter(page, "Campagne")).toHaveCount(0);
  await expect(page).toHaveURL(/\/prospects(\?view=table)?$/);
  await auditA11y(page, "prospects");
});

test("suivi : affectation administrative, étape justifiée et historique actualisé", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  let current = { ...member, conversion_stage: "applied" };
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
  await page.route("**/api/v1/campaign-prospects/11/confirm-enrollment", (route) => {
    const body = route.request().postDataJSON();
    changes.push({ confirmation: body });
    current = { ...current, conversion_stage: "converted" };
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
                  from_stage: "applied",
                  to_stage: "converted",
                  reason: "Inscription confirmée ; preuve : school_email ; référence : email admissions du 27 octobre",
                  created_at: "2026-10-15T12:00:00Z",
                },
              ]
            : [],
      },
    }),
  );
  await login(page);
  await page.goto("/prospects/1?tab=journey");
  await page
    .locator('button[data-membership="11"]')
    .click();
  const follow = page.getByRole("region", {
    name: "Suivi du parcours 11",
    exact: true,
  });
  await choose(follow.getByLabel("Conseiller responsable"), "8");
  await follow
    .getByRole("button", { name: "Enregistrer l’affectation" })
    .click();
  await expect(
    follow.getByText("Nadia", { exact: true }).first(),
  ).toBeVisible();
  const confirmation = follow.getByRole("form", { name: "Confirmation de l'inscription du parcours 11" });
  await expect(
    confirmation.getByRole("button", { name: "Confirmer l’inscription" }),
  ).toBeDisabled();
  await confirmation.getByLabel("Référence de la preuve").fill("email admissions du 27 octobre");
  await confirmation.getByRole("button", { name: "Confirmer l’inscription" }).click();
  await expect(
    page.getByText("Converti", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Inscription confirmée et historisée.").first()).toBeVisible();
  await page.getByRole("dialog", { name: "Parcours" }).getByRole("button", { name: "Fermer" }).click();
  await page.getByText("Historique du parcours 1", { exact: true }).click();
  await expect(page.getByText(/email admissions du 27 octobre/)).toBeVisible();
  expect(changes).toEqual([
    { assigned_advisor_id: 8 },
    { confirmation: { evidence_type: "school_email", evidence_reference: "email admissions du 27 octobre", note: null } },
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
  await page.goto("/prospects/1?tab=journey");
  await expect(page.getByLabel("Conseiller responsable")).toHaveCount(0);
  await page
    .locator('button[data-membership="11"]')
    .click();
  const stage = page.getByRole("form", {
    name: "Étape du parcours 11",
    exact: true,
  });
  await choose(stage.getByLabel("Nouvelle étape"), "applied");
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
  await page.goto("/prospects/1?tab=conversation");
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

test("exception individuelle : retour au responsable de la campagne", async ({
  page,
}) => {
  await mockApi(page);
  let override = true;
  let payload: unknown;
  await page.route("**/api/v1/advisors?**", (route) =>
    route.fulfill({ json: pageOf([{ id: 8, username: "Nadia" }]) }),
  );
  await page.route("**/api/v1/prospects/1", (route) =>
    route.fulfill({
      json: {
        ...prospect,
        campaigns: [
          {
            ...member,
            assigned_advisor_id: 8,
            assignment_is_override: override,
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/campaign-prospects/11", (route) => {
    payload = route.request().postDataJSON();
    override = false;
    return route.fulfill({
      json: {
        ...member,
        assigned_advisor_id: 8,
        assignment_is_override: false,
      },
    });
  });
  await login(page);
  await page.goto("/prospects/1?tab=journey");
  await page
    .locator('button[data-membership="11"]')
    .click();
  const follow = page.getByRole("region", {
    name: "Suivi du parcours 11",
    exact: true,
  });
  await expect(
    follow.getByText("Exception individuelle à la règle de campagne."),
  ).toBeVisible();
  await follow
    .getByRole("button", { name: "Suivre le responsable de campagne" })
    .click();
  await expect(
    follow.getByText("Affectation selon la règle de campagne."),
  ).toBeVisible();
  expect(payload).toEqual({ inherit_campaign_advisor: true });
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
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await expect(
    page.getByRole("grid").getByText("Très chaud", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Alice Martin" }).click();
  await expect(
    page.getByRole("heading", { name: "Alice Martin" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Parcours" }).click();
  await expect(page).toHaveURL(/\/prospects\/1\?tab=journey/);
  await expect(
    page.getByText("Historique du parcours 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Historique du parcours 2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lancer l'agent" }),
  ).toBeEnabled();
  // Jeton laissé par une version précédente de la console : effacé au chargement (AUDIT-SEC-004).
  await page.evaluate(() => localStorage.setItem("iagora.token", "ancien-jeton"));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("iagora.token")))
    .toBeNull();
  const logout = page.waitForRequest(
    (r) => r.url().endsWith("/auth/logout") && r.method() === "POST",
  );
  await page.getByRole("button", { name: /Menu du compte/ }).click();
  await page.getByRole("dialog", { name: "Menu du compte" }).getByRole("button", { name: "Déconnexion" }).click();
  await logout;
  await expect(page).toHaveURL(/\/login$/);
  // Session fermée côté serveur : revenir sur une page renvoie à la connexion, qui y ramènera.
  await page.goto("/prospects");
  await expect(page).toHaveURL(/\/login\?next=%2Fprospects$/);
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
  await selectFilter(page, "Étape", "qualified");
  await selectFilter(page, "Campagne", "3");
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
  await page.goto("/prospects/1?tab=conversation");
  await expect(page.getByText(/accès observateur permet de consulter/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Lancer l'agent" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Autres actions" })).toHaveCount(0);
  await expect(page.getByText("Observateur", { exact: true })).toBeVisible();
});

test("session expirée : retour à la connexion, puis à la page en cours", async ({ page }) => {
  await mockApi(page);
  await login(page);
  let expired = true;
  await page.route("**/api/v1/prospects/1", (route) =>
    expired ? route.fulfill({ status: 401, json: { detail: "Session expirée" } }) : route.fallback(),
  );
  await page.goto("/prospects/1?tab=journey");
  await expect(page).toHaveURL(/\/login\?next=%2Fprospects%2F1%3Ftab%3Djourney$/);
  // La redirection vient de la page elle-même : attendre que la page de connexion soit prête avant de saisir.
  await page.waitForLoadState("networkidle");
  expired = false;
  await page.getByLabel("Email ou nom").fill("conseiller");
  await page.getByLabel("Mot de passe").fill("valid-password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/prospects\/1\?tab=journey$/);
  await expect(page.getByRole("heading", { name: "Alice Martin" })).toBeVisible();
});

test("connexion : arrivée sur l'accueil ; une adresse de retour externe est ignorée", async ({ page }) => {
  await mockApi(page);
  for (const next of ["", "?next=https%3A%2F%2Fexemple.com", "?next=%2F%2Fexemple.com%2Fprospects"]) {
    await page.goto(`/login${next}`);
    await page.getByLabel("Email ou nom").fill("conseiller");
    await page.getByLabel("Mot de passe").fill("valid-password");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL("http://localhost:3100/");
    await expect(page.getByRole("heading", { name: /^Bonjour/ })).toBeVisible();
  }
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
  // Menu mobile : Drawer HeroUI, refermé par Échap.
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir le menu" })).toHaveAttribute("aria-expanded", "false");
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
  await page.goto("/prospects/1?tab=journey");
  await expect(page.getByRole("link", { name: "eBIHAR" })).toHaveAttribute(
    "href",
    "/campaigns/3",
  );
  await expect(
    page.getByRole("link", { name: "Ouvrir dans Conversations" }),
  ).toHaveAttribute("href", "/conversations?id=conversation-1");
  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(page.getByText("Ouverte").first()).toBeVisible();
  const optOut = async () => {
    await page.getByRole("button", { name: "Autres actions" }).click();
    await page.getByRole("menuitem", { name: "Enregistrer une désinscription" }).click();
    return page.getByRole("alertdialog", { name: "Enregistrer la désinscription ?" });
  };
  await (await optOut()).getByRole("button", { name: "Annuler" }).click();
  expect(posts).toHaveLength(0);
  await (await optOut()).getByRole("button", { name: "Enregistrer la désinscription" }).click();
  await expect(page.getByText("Désinscription enregistrée.")).toBeVisible();
  expect(posts[0].body).toMatchObject({ channel: "email" });
});

test("fiche : effacer un prospect (administrateur) et lister ce qui reste à la main", async ({
  page,
}) => {
  await mockApi(page, "ADMIN");
  const posts: unknown[] = [];
  await page.route("**/api/v1/prospects/1/erase", async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        prospect_id: 1,
        conversations: 1,
        interactions: 4,
        appointments: 1,
        suppressed: true,
        external_events: [
          {
            start_at: "2026-11-03T14:00:00Z",
            advisor: "nadia",
            calendar_event_id: "evt-1",
            zoom_meeting_id: "zoom-1",
            meeting_url: null,
          },
        ],
      },
    });
  });
  await login(page);
  await page.goto("/prospects/1");
  await page.getByRole("button", { name: "Autres actions" }).click();
  await page.getByRole("menuitem", { name: "Effacer ce prospect…" }).click();
  const panel = page.getByRole("dialog", { name: "Effacer ce prospect" });
  const confirmButton = panel.getByRole("button", {
    name: "Effacer définitivement",
  });
  await expect(confirmButton).toBeDisabled();
  await panel.getByLabel("Adresse email du prospect").fill("alice@example.com");
  await choose(panel.getByRole("button", { name: /Motif/ }), "other");
  await confirmButton.click();
  await expect(
    page.getByRole("heading", { name: "Prospect effacé" }),
  ).toBeVisible();
  expect(posts[0]).toEqual({ reason: "other", confirm: "alice@example.com" });
  const manual = page.getByRole("region", { name: "À supprimer à la main" });
  await expect(manual).toContainText("boîte de l’école");
  await expect(manual).toContainText("agenda de nadia");
  await expect(manual).toContainText("evt-1");
  await expect(
    page.getByRole("region", { name: "Résultat de l’effacement" }),
  ).toContainText("empreinte illisible");
});

test("fiche : l’effacement est refusé par l’API puis annulable", async ({
  page,
}) => {
  await mockApi(page, "ADMIN");
  await page.route("**/api/v1/prospects/1/erase", (route) =>
    route.fulfill({
      status: 422,
      json: {
        detail:
          "La confirmation ne correspond pas à l'adresse email du prospect",
      },
    }),
  );
  await login(page);
  await page.goto("/prospects/1");
  await page.getByRole("button", { name: "Autres actions" }).click();
  await page.getByRole("menuitem", { name: "Effacer ce prospect…" }).click();
  const panel = page.getByRole("dialog", { name: "Effacer ce prospect" });
  await panel.getByLabel("Adresse email du prospect").fill("autre@example.com");
  await panel.getByRole("button", { name: "Effacer définitivement" }).click();
  await expect(panel.getByRole("alert")).toContainText("ne correspond pas");
  await expect(
    page.getByRole("heading", { name: "Alice Martin" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Annuler" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Alice Martin" })).toBeVisible();
});

test("fiche : seuls les administrateurs voient l’effacement", async ({
  page,
}) => {
  await mockApi(page, "ADVISOR");
  await login(page);
  await page.goto("/prospects/1");
  await expect(
    page.getByRole("heading", { name: "Alice Martin" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Autres actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Enregistrer une désinscription" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Effacer ce prospect…" })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Autres actions" })).toHaveCount(0);
  await expect(page.getByText(/désinscription/)).toHaveCount(0);
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
  await selectFilter(page, "Programme", "ebihar_students");
  await selectFilter(page, "Intérêt", "very_hot");
  await selectFilter(page, "Canal", "email");
  await selectFilter(page, "Consentement", "granted");
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
  await expect(activeFilter(page, "Programme")).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
  await expect(activeFilter(page, "Programme")).toHaveCount(0);
  await expect(page).toHaveURL(/\/prospects$/);
});

test("panneau de filtres : nombre de filtres actifs, puces retirables et compteur « N sur M »", async ({
  page,
}) => {
  await mockApi(page);
  await login(page);
  const open = page.getByRole("button", { name: /^Filtres/ });
  await expect(page.getByLabel("Intérêt")).toHaveCount(0);
  await open.click();
  const panel = page.getByRole("dialog", { name: "Filtres" });
  await expect(panel.getByLabel("Étape", { exact: true })).toBeVisible();
  await auditA11y(page, "prospects, panneau de filtres");
  await panel.getByRole("button", { name: "Fermer" }).click();
  await selectFilter(page, "Intérêt", "very_hot");
  await expect(open).toHaveAccessibleName(/1 actif/);
  const chip = activeFilter(page, "Intérêt");
  await expect(chip).toContainText("Très chaud");
  await expect(page.getByRole("region", { name: "Affichage et filtres des prospects" }).getByRole("status")).toHaveText("26 prospects sur 26");
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(open).not.toHaveAccessibleName(/actif/);
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
  await selectFilter(page, "Programme", "ebihar_students");
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
  await page.getByRole("button", { name: "Attribuer une campagne" }).click();
  await expect(page).toHaveURL(/tab=journey/);
  const form = page.getByRole("form", { name: "Attribution commerciale" });
  await expect(
    form.getByRole("button", { name: "Attribuer et démarrer le suivi" }),
  ).toBeDisabled();
  await choose(form.getByLabel("Campagne d’attribution"), "3");
  await expect(
    form.getByRole("button", { name: "Attribuer et démarrer le suivi" }),
  ).toBeDisabled();
  await choose(form.getByLabel("Source d’attribution"), "7");
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

test("conseiller : pas de file À attribuer (réservée à l'administrateur)", async ({ page }) => {
  await mockApi(page, "ADVISOR");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await login(page);
  await page.goto("/prospects");
  await expect(page.getByRole("button", { name: "Mes prospects" })).toBeVisible();
  // Décision D-23 : un conseiller ne voit que les prospects de ses campagnes.
  await expect(page.getByRole("button", { name: /^À attribuer/ })).toHaveCount(0);
  expect(requests.some((u) => u.includes("pending_campaign=true"))).toBe(false);
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
        (u) => u.includes("pending_campaign=true") && u.includes("limit=100"),
      ),
    )
    .toBe(true);
  await page.goto("/prospects/1");
  await expect(page.getByText("Attribuer une campagne et une source")).toBeVisible();
  await expect(page.getByRole("button", { name: "Attribuer une campagne" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Parcours" }).click();
  await expect(page.getByText(/Choisissez une campagne et une source/)).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Attribution commerciale" }),
  ).toHaveCount(0);
});

test("résultats : filtres, table et page conservés après fiche, actualisation et export", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, "ADMIN", { ...prospect, email: "alice@demo.example.com", campaigns: [{ ...member, assigned_advisor_id: 1 }] });
  await page.route("**/api/v1/campaigns?**", route => route.fulfill({ json: pageOf([
    { id: 3, name: "eBIHAR", sources: [{ id: 7, name: "Formulaire" }] },
  ]) }));
  const queries: URLSearchParams[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    // Les totaux (« À attribuer », « N sur M ») sont lus avec limit=1 : seules les lectures de la liste comptent.
    if (url.pathname === "/api/v1/prospects" && url.searchParams.get("limit") !== "1") queries.push(url.searchParams);
  });
  await login(page);
  await page.getByRole("tab", { name: "Table", exact: true }).click();
  await page.getByLabel("Rechercher", { exact: true }).fill("Alice");
  await selectFilter(page, "Campagne", "3");
  await selectFilter(page, "Source", "7");
  await selectFilter(page, "Étape", "qualified");
  await page.getByRole("button", { name: "Mes prospects", exact: true }).click();
  await selectFilter(page, "Programme", "ebihar_students");
  await selectFilter(page, "Intérêt", "very_hot");
  await selectFilter(page, "Canal", "email");
  await selectFilter(page, "Consentement", "granted");
  await page.getByRole("button", { name: "Suivant" }).click();
  await expect(page.getByText("26-26 sur 26", { exact: true })).toBeVisible();
  const results = page.url();
  const expected = {
    q: "Alice", campaign_id: "3", source_id: "7", stage: "qualified", advisor_id: "1",
    target_code: "ebihar_students", level: "very_hot", channel: "email", consent_status: "granted",
    limit: "25", offset: "25",
  };
  await page.getByRole("link", { name: "Alice Martin", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alice Martin", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "Retour aux résultats", exact: true }).click();
  await expect(page).toHaveURL(results);
  await expect(page.getByRole("tab", { name: "Table", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(activeFilter(page, "Campagne")).toContainText("eBIHAR");
  await expect(activeFilter(page, "Source")).toContainText("Formulaire");
  await expect(page.getByLabel("Rechercher", { exact: true })).toHaveValue("Alice");
  await expect(activeFilter(page, "Intérêt")).toBeVisible();
  await page.reload();
  await expect(page.getByText("26-26 sur 26", { exact: true })).toBeVisible();
  for (const [key, value] of Object.entries(expected)) expect(queries.at(-1)?.get(key)).toBe(value);
  let exported = "";
  await page.route("**/api/v1/prospects/export**", route => {
    exported = route.request().url();
    return route.fulfill({ body: "id;nom\n1;Alice", headers: { "content-type": "text/csv" } });
  });
  await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter en CSV (Excel)" }).click()]);
  for (const [key, value] of Object.entries(expected).filter(([key]) => !["limit", "offset"].includes(key))) {
    expect(new URL(exported).searchParams.get(key)).toBe(value);
  }
  await page.getByRole("button", { name: "Retirer le filtre Intérêt" }).click();
  await expect(page.getByText("1-25 sur 26", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("offset")).toBe(false);
});

test("navigation : retour navigateur, pipeline et recherche d’en-tête sur une liste déjà ouverte", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await selectFilter(page, "Campagne", "3");
  const results = page.url();
  await page.locator(".pipeline-card").first().click();
  await expect(page.getByRole("link", { name: "Retour aux résultats" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(results);
  await expect(page.getByRole("tab", { name: "Pipeline", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(activeFilter(page, "Campagne")).toContainText("eBIHAR");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Alice Martin", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Retour aux résultats" }).click();
  await expect(page).toHaveURL(results);
  await expect(activeFilter(page, "Campagne")).toContainText("eBIHAR");
  // Règle 6 : un filtre remplace l'adresse sans entrée d'historique ; « Retour » quitte la liste.
  await selectFilter(page, "Étape", "qualified");
  await expect(page).toHaveURL(/stage=qualified/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Alice Martin", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Retour aux résultats" }).click();
  await expect(page).toHaveURL(results);
  await page.getByRole("button", { name: /Rechercher un prospect, une page/ }).click();
  await page.getByRole("dialog", { name: "Recherche rapide" }).getByRole("searchbox").fill("inexistant");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Rechercher", { exact: true })).toHaveValue("inexistant");
  await expect(page.getByRole("heading", { name: "Aucun prospect ne correspond" })).toBeVisible();
  await page.goBack();
  await expect(activeFilter(page, "Campagne")).toContainText("eBIHAR");
  await expect(page.getByLabel("Rechercher", { exact: true })).toHaveValue("");
});

test("liens directs : paramètres invalides ignorés et retour limité aux prospects", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await page.goto("/prospects?view=incorrect&offset=-25&stage=invented&campaign=no&source=7&mine=true&demo=exclude&pending_campaign=true");
  await expect(page.getByRole("tab", { name: "Pipeline", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Mes prospects", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(activeFilter(page, "Prospects fictifs")).toBeVisible();
  await expect(activeFilter(page, "Étape")).toHaveCount(0);
  await page.getByRole("button", { name: /^Filtres/ }).click();
  const panel = page.getByRole("dialog", { name: "Filtres" });
  await expect(panel.getByLabel("Masquer les prospects fictifs")).toBeChecked();
  await expect(panel.getByLabel("Étape", { exact: true })).toHaveAttribute("data-value", "");
  await expect(panel.getByLabel("Source", { exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
  await expect(page).toHaveURL(/\/prospects$/);
  for (const from of ["https://example.com", "//example.com", "/prospects/other", "/prospects/../settings"]) {
    await page.goto(`/prospects/1?from=${encodeURIComponent(from)}`);
    await expect(page.getByRole("link", { name: "Tous les prospects", exact: true })).toHaveAttribute("href", "/prospects");
  }
});

test("fiche : onglet dans l'adresse, retour conservé après actualisation", async ({ page }) => {
  await mockApi(page);
  await login(page);
  const from = "/prospects?view=table";
  await page.goto(`/prospects/1?from=${encodeURIComponent(from)}`);
  await expect(page.getByRole("tab", { name: "Vue d'ensemble" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Décisions de l'agent" }).click();
  await expect(page).toHaveURL(/tab=decisions/);
  await expect(page).toHaveURL(new RegExp(`from=${encodeURIComponent(from).replace(/[?]/g, "\\?")}`));
  await expect(page.getByText("L’agent n’a pas encore traité ce prospect.")).toBeVisible();
  await auditA11y(page, "fiche prospect, onglet Décisions");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Décisions de l'agent" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: "Retour aux résultats" })).toHaveAttribute(
    "href",
    "/prospects?view=table",
  );
  await page.goto("/prospects/1?tab=inconnu");
  await expect(page.getByRole("tab", { name: "Vue d'ensemble" })).toHaveAttribute("aria-selected", "true");
});

test("fiche : l'agent n'est lancé qu'après confirmation", async ({ page }) => {
  await mockApi(page);
  const posts: unknown[] = [];
  await page.route("**/api/v1/agent/runs", async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  await login(page);
  await page.goto("/prospects/1");
  await page.getByRole("button", { name: "Lancer l'agent" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Lancer l’agent ?" });
  await dialog.getByRole("button", { name: "Annuler" }).click();
  expect(posts).toHaveLength(0);
  await page.getByRole("button", { name: "Lancer l'agent" }).click();
  await dialog.getByRole("button", { name: "Lancer l’agent" }).click();
  await expect(page.getByText("Décision de l’agent enregistrée.")).toBeVisible();
  expect(posts).toEqual([{ conversation_id: "conversation-1" }]);
});

test("fiche : lancement impossible, raison lisible", async ({ page }) => {
  await mockApi(page, "ADMIN", { ...prospect, campaigns: [] });
  await login(page);
  await page.goto("/prospects/1");
  const launch = page.getByRole("button", { name: "Lancer l'agent" });
  await expect(launch).toBeDisabled();
  await launch.focus();
  await expect(page.getByRole("tooltip")).toContainText("Attribuez d’abord une campagne");
});

test("fiche : consentement saisi dans un panneau, saisie protégée", async ({ page }) => {
  await mockApi(page, "ADVISOR", { ...prospect, consent_status: "unknown", consent_source: "" });
  const posts: unknown[] = [];
  await page.route("**/api/v1/prospects/1/consent", async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ json: { ...prospect } });
  });
  await login(page);
  await page.goto("/prospects/1");
  await page.getByRole("button", { name: "Autres actions" }).click();
  await page.getByRole("menuitem", { name: "Enregistrer un consentement" }).click();
  const panel = page.getByRole("dialog", { name: "Enregistrer un consentement" });
  const save = panel.getByRole("button", { name: "Enregistrer le consentement" });
  await expect(save).toBeDisabled();
  await panel.getByLabel("Source du consentement").fill("accord donné par téléphone le 12/10");
  await auditA11y(page, "fiche prospect, panneau Consentement");
  await panel.getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("alertdialog", { name: "Abandonner les modifications ?" })
    .getByRole("button", { name: "Continuer la saisie" })
    .click();
  await expect(panel.getByLabel("Source du consentement")).toHaveValue("accord donné par téléphone le 12/10");
  await save.click();
  await expect(page.getByText("Consentement enregistré.")).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(posts).toEqual([{ source: "accord donné par téléphone le 12/10", channel: "email" }]);
});

test("lever une désinscription exige un motif écrit (administrateur)", async ({ page }) => {
  await mockApi(page, "ADMIN", { ...prospect, consent_status: "opted_out" });
  const posts: unknown[] = [];
  await page.route("**/api/v1/prospects/1/consent", async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ json: { ...prospect } });
  });
  await login(page);
  await page.goto("/prospects/1");
  await page.getByRole("button", { name: "Autres actions" }).click();
  await page.getByRole("menuitem", { name: "Lever la désinscription (administrateur)" }).click();
  const panel = page.getByRole("dialog", { name: "Lever la désinscription" });
  const save = panel.getByRole("button", { name: "Enregistrer le consentement" });
  await panel.getByLabel("Source du consentement").fill("appel téléphonique");
  // Décision D-20 : sans motif (10 caractères au moins), la levée est impossible.
  await expect(save).toBeDisabled();
  await panel.getByLabel("Motif et preuve").fill("court");
  await expect(save).toBeDisabled();
  await panel.getByLabel("Motif et preuve").fill("Email du 12/11 où il redemande les dates de rentrée.");
  await auditA11y(page, "fiche prospect, levée de désinscription");
  await save.click();
  await expect(page.getByText("Consentement enregistré.")).toBeVisible();
  expect(posts).toEqual([
    {
      source: "appel téléphonique",
      channel: "email",
      reason: "Email du 12/11 où il redemande les dates de rentrée.",
    },
  ]);
});

test("recherche : une seule requête une fois la frappe arrêtée", async ({ page }) => {
  await mockApi(page);
  await login(page);
  const searched: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/v1/prospects") && url.searchParams.has("q")) searched.push(url.searchParams.get("q") ?? "");
  });
  const search = page.getByRole("searchbox", { name: "Rechercher" });
  await search.pressSequentially("alice", { delay: 40 });
  // Le champ et l'adresse suivent la saisie sans délai.
  await expect(search).toHaveValue("alice");
  await expect(page).toHaveURL(/q=alice/);
  await expect(page.getByRole("status").filter({ hasText: /prospect/ })).toHaveText("26 prospects sur 26");
  await page.waitForTimeout(500);
  expect(searched.filter((q) => q !== "")).toEqual(["alice"]);
});
