import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

const current = {
  llm_provider: "gemini",
  llm_model: "gemini-2.5-flash",
  llm_fallback_model: "",
  llm_temperature: 0.3,
  agent_auto_reply: true,
  follow_up_window_start_hour: 8,
  follow_up_window_end_hour: 19,
  follow_up_weekdays_only: true,
  follow_up_max_per_silence: 3,
  email_footer: "Répondez STOP.",
  email_ai_notice:
    "Ce message a été rédigé avec l'aide d'un assistant virtuel (IA).",
  email_brand_name: "DATUM Academy",
  email_brand_color: "#1f4fd8",
  email_logo_url: "",
  email_create_unknown_senders: true,
  email_poll_seconds: 60,
  calendar_timezone: "Europe/Paris",
  calendar_work_days: "1,2,3,4,5",
  calendar_work_start_hour: 9,
  calendar_work_end_hour: 18,
  calendar_slot_minutes: 30,
  calendar_min_notice_hours: 4,
  calendar_horizon_days: 14,
  calendar_buffer_minutes: 0,
  source: "env",
  gemini_api_key_set: true,
  openai_api_key_set: false,
  embedding_model: "gemini/gemini-embedding-001",
};

async function mockApi(page: Page, calls: unknown[], role = "ADMIN") {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me")
      body = { id: 1, username: "admin", email: "a@example.com", role };
    else if (path === "/settings" && request.method() === "PUT") {
      calls.push({ put: request.postDataJSON() });
      await route.fulfill({ status: 204, body: "" });
      return;
    } else if (path === "/settings") body = current;
    else if (path === "/settings/llm/test") {
      calls.push({ test: request.postDataJSON() });
      body = { ok: true, model: "gemini-2.5-flash", detail: "ok" };
    } else if (path === "/settings/email/preview") {
      calls.push({ preview: request.postDataJSON() });
      body = { html: "<p>Exemple IAGORA</p>", text: "Exemple" };
    } else if (path === "/todo")
      body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
}

/** Affiche une catégorie de paramètres depuis la navigation latérale. */
async function goSection(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Catégories de paramètres" })
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("régler le modèle de secours, tester puis enregistrer", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await mockApi(page, calls);
  await login(page);
  await page.goto("/settings");
  const ia = page.getByRole("region", { name: "Intelligence artificielle" });
  await ia
    .getByLabel("Modèle de secours (si le principal est saturé)")
    .fill("gemini-2.5-flash-lite");
  await ia.getByLabel("Clé d’API Gemini").fill("AIza-nouvelle");
  await ia.getByRole("button", { name: "Tester le modèle" }).click();
  await expect(ia.getByLabel("Résultat du test du modèle")).toContainText(
    "gemini-2.5-flash répond",
  );
  await goSection(page, "Rendez-vous");
  const slots = page.getByRole("region", {
    name: "Disponibilités des rendez-vous",
  });
  await slots.getByLabel("Sam").check();
  await slots.getByLabel("Début de journée (heure)").fill("10");
  await page
    .getByRole("button", { name: "Enregistrer les paramètres" })
    .click();
  await expect(page.getByText(/Paramètres enregistrés/)).toBeVisible();
  const put = calls.find((c) => (c as { put?: unknown }).put) as {
    put: Record<string, unknown>;
  };
  expect(put.put).toMatchObject({
    llm_fallback_model: "gemini-2.5-flash-lite",
    gemini_api_key: "AIza-nouvelle",
    calendar_work_days: "1,2,3,4,5,6",
    calendar_work_start_hour: 10,
  });
  expect(put.put).not.toHaveProperty("gemini_api_key_set");
  await auditA11y(page, "paramètres");
});

test("régler la mise en page des emails et voir un aperçu", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await mockApi(page, calls);
  await login(page);
  await page.goto("/settings");
  await goSection(page, "Emails");
  const emails = page.getByRole("region", { name: "Emails" });
  const notice = emails.getByLabel("Mention « message rédigé avec une IA »");
  await expect(notice).toHaveValue(/assistant virtuel/);
  await notice.fill("Message préparé par notre assistant IA.");
  await emails.getByLabel("Nom affiché en tête d’email").fill("École test");
  await emails.getByLabel("Couleur principale des emails").fill("#0a7a4b");
  await emails
    .getByLabel("Logo (adresse https, facultatif)")
    .fill("https://exemple.test/logo.png");
  await emails.getByRole("button", { name: "Voir un exemple d’email" }).click();
  await expect(
    page
      .frameLocator("iframe[title='Aperçu de l’email']")
      .getByText("Exemple IAGORA"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enregistrer les paramètres" })
    .click();
  await expect(page.getByText(/Paramètres enregistrés/)).toBeVisible();
  const put = calls.find((c) => (c as { put?: unknown }).put) as {
    put: Record<string, unknown>;
  };
  expect(put.put).toMatchObject({
    email_ai_notice: "Message préparé par notre assistant IA.",
    email_brand_name: "École test",
    email_brand_color: "#0a7a4b",
    email_logo_url: "https://exemple.test/logo.png",
  });
  // L'aperçu d'email est un document isolé (iframe sans script), hors de l'interface.
  await auditA11y(page, "paramètres (emails)", [".email-preview"]);
});

test("l’observateur n’accède pas aux paramètres", async ({ page }) => {
  await mockApi(page, [], "VIEWER");
  await login(page);
  await page.goto("/settings");
  await expect(page.getByText("réservée aux administrateurs")).toBeVisible();
});

test.describe("navigation du simulateur", () => {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_SIMULATOR !== "false";
  for (const role of ["ADMIN", "ADVISOR", "VIEWER"]) {
    test(`${role} : accès à l’espace de test selon le rôle et l’environnement`, async ({
      page,
    }) => {
      await mockApi(page, [], role);
      const adminRequests: string[] = [];
      const mutations: string[] = [];
      page.on("request", (r) => {
        const path = new URL(r.url()).pathname;
        if (path === "/api/v1/settings") adminRequests.push(r.method());
        if (
          path.startsWith("/api/v1/") &&
          r.method() !== "GET" &&
          !path.endsWith("/auth/login")
        )
          mutations.push(path);
      });
      await login(page);
      await page.goto("/settings");
      const allowed = enabled && role !== "VIEWER";
      const nav = page.getByRole("navigation", {
        name: "Navigation principale",
      });
      await expect(nav.locator('a[href="/simulator"]')).toHaveCount(0);
      if (role === "ADMIN" || allowed)
        await expect(
          nav.getByRole("link", { name: "Paramètres", exact: true }),
        ).toBeVisible();
      else
        await expect(
          nav.getByRole("link", { name: "Paramètres", exact: true }),
        ).toHaveCount(0);
      if (allowed) {
        await page
          .getByRole("link", {
            name: /Ouvrir l’espace de test|Tests et démonstration/,
          })
          .first()
          .click();
        await expect(page).toHaveURL(/\/settings\/testing$/);
        await expect(
          page.getByRole("heading", {
            name: "Tests et démonstration",
            exact: true,
          }),
        ).toBeVisible();
        await page.getByRole("link", { name: "Ouvrir le simulateur" }).click();
        await expect(page).toHaveURL(/\/simulator$/);
        await expect(
          page.getByRole("status", { name: "Mode du simulateur" }),
        ).toContainText("données fictives");
      } else {
        await expect(
          page.getByRole("link", { name: "Ouvrir l’espace de test" }),
        ).toHaveCount(0);
        await page.goto("/settings/testing");
        await expect(
          page.getByRole("link", { name: "Ouvrir le simulateur" }),
        ).toHaveCount(0);
        await page.goto("/simulator");
        await expect(
          page.getByRole("button", { name: "Créer un prospect fictif" }),
        ).toHaveCount(0);
        await expect(
          page.getByText(
            enabled
              ? "Le simulateur est réservé aux conseillers et aux administrateurs."
              : "Le simulateur est désactivé sur cet environnement.",
          ),
        ).toBeVisible();
      }
      if (role !== "ADMIN") {
        expect(adminRequests).toHaveLength(0);
        await expect(
          page.getByRole("region", {
            name: "Intelligence artificielle",
            exact: true,
          }),
        ).toHaveCount(0);
      }
      expect(mutations).toHaveLength(0);
    });
  }
});

test("les réglages modifiés doivent être enregistrés avant l’essai", async ({
  page,
}) => {
  await mockApi(page, []);
  await login(page);
  await page.goto("/settings");
  await goSection(page, "Agent et relances");
  const agent = page.getByRole("region", {
    name: "Agent et relances",
    exact: true,
  });
  await expect(
    agent.getByRole("link", { name: "Tester les réglages enregistrés" }),
  ).toHaveAttribute("href", "/simulator");
  await goSection(page, "Intelligence artificielle");
  await page
    .getByRole("region", { name: "Intelligence artificielle" })
    .getByLabel("Modèle principal", { exact: true })
    .fill("autre-modele");
  await goSection(page, "Agent et relances");
  await expect(
    agent.getByRole("button", {
      name: "Tester les réglages enregistrés",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    agent.getByRole("link", { name: "Tester les réglages enregistrés" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Enregistrer les paramètres", exact: true })
    .click();
  await expect(
    agent.getByRole("link", { name: "Tester les réglages enregistrés" }),
  ).toBeVisible();
});

test("les paramètres s'affichent par catégorie, sans perdre les saisies", async ({
  page,
}) => {
  await mockApi(page, []);
  await login(page);
  await page.goto("/settings");
  const ia = page.getByRole("region", { name: "Intelligence artificielle" });
  const emails = page.getByRole("region", { name: "Emails" });
  const nav = page.getByRole("navigation", {
    name: "Catégories de paramètres",
  });
  // Une seule catégorie à la fois ; la première par défaut.
  await expect(ia).toBeVisible();
  await expect(emails).toBeHidden();
  await expect(
    nav.getByRole("link", { name: /^Intelligence artificielle/ }),
  ).toHaveAttribute("aria-current", "page");

  await ia.getByLabel("Modèle principal", { exact: true }).fill("modele-x");
  await goSection(page, "Emails");
  await expect(page).toHaveURL(/section=emails/);
  await expect(emails).toBeVisible();
  await expect(ia).toBeHidden();
  await goSection(page, "Intelligence artificielle");
  await expect(ia.getByLabel("Modèle principal", { exact: true })).toHaveValue(
    "modele-x",
  );
  // La barre d'enregistrement reste commune à toutes les catégories.
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  await goSection(page, "Rendez-vous");
  await expect(
    page.getByRole("button", { name: "Enregistrer les paramètres" }),
  ).toBeVisible();

  // Un lien direct ouvre la bonne catégorie ; une valeur inconnue retombe sur la première.
  await page.goto("/settings?section=agent");
  await expect(
    page.getByRole("region", { name: "Agent et relances" }),
  ).toBeVisible();
  await page.goto("/settings?section=inconnue");
  await expect(
    page.getByRole("region", { name: "Intelligence artificielle" }),
  ).toBeVisible();
});

test("paramètres sur mobile : catégorie choisie dans une liste, sans défilement horizontal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, []);
  await login(page);
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "Catégorie", exact: true })
    .selectOption("emails");
  await expect(page).toHaveURL(/section=emails/);
  await expect(page.getByRole("region", { name: "Emails" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
