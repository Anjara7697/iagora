import { expect, test, type Page } from "@playwright/test";

const status = (over: Record<string, unknown> = {}) => ({
  configured: true,
  enabled: true,
  send_enabled: false,
  sender: "agent@datum.test",
  imap_host: "imap.ionos.fr",
  smtp_host: "smtp.ionos.fr",
  sandbox_recipients: ["moi@example.com"],
  last_run_at: "2026-10-01T10:00:00Z",
  last_error: null,
  last_report: null,
  outbox: { not_sent: 2, sent: 5 },
  ...over,
});

const config = {
  address: "agent@datum.test",
  username: null,
  imap_host: "imap.ionos.fr",
  imap_port: 993,
  imap_folder: "INBOX",
  smtp_host: "smtp.ionos.fr",
  smtp_port: 587,
  smtp_security: "starttls",
  from_name: "DATUM Academy",
  enabled: true,
  send_enabled: false,
  sandbox_recipients: ["moi@example.com"],
  source: "env",
  password_set: true,
};

async function mockApi(
  page: Page,
  opts: {
    role?: string;
    status?: unknown;
    check?: unknown;
    saved?: unknown[];
  } = {},
) {
  const calls: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
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
    else if (path === "/integrations/email") body = opts.status ?? status();
    else if (path === "/integrations/calendar") {
      if (request.method() === "PUT") {
        opts.saved?.push({ calendar: request.postDataJSON() });
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      body = {
        provider: "none",
        source: "console",
        google_client_id: "",
        client_secret_set: false,
        default_user_id: null,
        redirect_uri: "http://localhost:8000/api/v1/calendar/google/callback",
        connections: [],
      };
    } else if (path === "/integrations/zoom") {
      if (request.method() === "PUT") {
        opts.saved?.push({ zoom: request.postDataJSON() });
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      body = {
        mode: "none",
        source: "console",
        account_id: "",
        client_id: "",
        client_secret_set: false,
        host_user: "me",
        redirect_uri: "http://localhost:8000/api/v1/zoom/callback",
        connections: [],
      };
    } else if (path === "/integrations/tokens") {
      if (request.method() === "POST") {
        const sent = request.postDataJSON();
        opts.saved?.push({ token: sent });
        body = {
          id: "t1",
          ...sent,
          hint: "iag_abcdef…",
          channel: "web_form",
          target_code: null,
          created_at: "2026-10-23T10:00:00Z",
          last_used_at: null,
          revoked_at: null,
          token: "iag_abcdefSECRET",
        };
        code = 201;
      } else body = [];
    } else if (path === "/campaigns")
      body = {
        items: [
          {
            id: 4,
            name: "Rentrée 2027",
            status: "active",
            targets: [],
            sources: [{ id: 9, name: "Site", type: "form", platform: "web" }],
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
      };
    else if (path === "/advisors")
      body = {
        items: [{ id: 2, username: "paul" }],
        total: 1,
        limit: 200,
        offset: 0,
      };
    else if (path === "/integrations/email/config") {
      if (request.method() === "PUT") {
        const sent = request.postDataJSON();
        opts.saved?.push(sent);
        body = { ...sent, source: "console", password_set: true };
      } else body = config;
    } else if (path === "/integrations/email/autodetect")
      body = {
        provider: "OVHcloud",
        imap_host: "ssl0.ovh.net",
        imap_port: 993,
        smtp_host: "ssl0.ovh.net",
        smtp_port: 587,
        smtp_security: "starttls",
        source: "mx",
        note: null,
      };
    else if (path === "/integrations/email/test")
      body = {
        imap: "ok",
        smtp: "ok",
        folders: [
          { name: "INBOX", label: "INBOX" },
          { name: "INBOX/test", label: "INBOX/test" },
          { name: "Programm&AOk-", label: "Programmé" },
        ],
      };
    else if (path === "/integrations/email/check") {
      calls.push(path);
      body = opts.check ?? { imap: "ok", smtp: "ok" };
    } else if (path === "/integrations/email/sync") {
      calls.push(path);
      body = {
        report: { received: 1, sent: 2, blocked: 0, errors: 0, notes: [] },
      };
    } else if (path === "/todo")
      body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
  return calls;
}

async function open(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto("/integrations");
}

test("affiche l'état de la boîte email sans aucun secret", async ({ page }) => {
  await mockApi(page);
  await open(page);
  const card = page.getByRole("region", { name: "Email" });
  await expect(card.getByText("Envoi désactivé")).toBeVisible();
  await expect(card.getByText("Réception active")).toBeVisible();
  await expect(card.getByText("agent@datum.test")).toBeVisible();
  await expect(card.getByText(/n’écrit qu’à moi@example.com/)).toBeVisible();
  await expect(card.getByText("Prêt à envoyer")).toBeVisible();
  await expect(card.getByText("Connecté", { exact: true })).toBeVisible();
  // Canaux prévus mais pas encore développés : annoncés comme tels, sans action.
  await expect(
    page.getByRole("region", { name: "Agenda" }).getByText("Non branché"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Zoom" }).getByText("Non branché"),
  ).toBeVisible();
  for (const name of ["Meta Business", "LinkedIn"])
    await expect(
      page.getByRole("region", { name }).getByText("À venir"),
    ).toBeVisible();
});

test("lancer un passage demande confirmation quand l'envoi est activé", async ({
  page,
}) => {
  await mockApi(page, { status: status({ send_enabled: true }) });
  const calls: string[] = [];
  await page.route("**/api/v1/integrations/email/sync", async (route) => {
    calls.push("sync");
    await route.fulfill({ json: { report: {} } });
  });
  await open(page);
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page
    .getByRole("button", { name: "Lancer un passage maintenant" })
    .click();
  expect(calls).toHaveLength(0);
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Lancer un passage maintenant" })
    .click();
  await expect(page.getByText("0 reçu(s), 0 envoyé(s)")).toBeVisible();
});

test("tester la connexion affiche IMAP et SMTP", async ({ page }) => {
  const calls = await mockApi(page, {
    check: { imap: "IMAP : identifiants refusés", smtp: "ok" },
  });
  await open(page);
  await page
    .getByRole("button", { name: "Tester la boîte enregistrée" })
    .click();
  await expect(page.getByText("✗ IMAP : identifiants refusés")).toBeVisible();
  await expect(page.getByText("✓ connecté")).toBeVisible();
  expect(calls).toEqual(["/integrations/email/check"]);
});

test("lancer un passage résume le résultat", async ({ page }) => {
  await mockApi(page);
  await open(page);
  await page
    .getByRole("button", { name: "Lancer un passage maintenant" })
    .click();
  await expect(
    page.getByText("1 reçu(s), 2 envoyé(s), 0 bloqué(s), 0 erreur(s)"),
  ).toBeVisible();
});

test("boîte non configurée : message clair et actions désactivées", async ({
  page,
}) => {
  await mockApi(page, {
    status: status({ configured: false, enabled: false, sender: null }),
  });
  await open(page);
  await expect(page.getByText(/Boîte non configurée/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tester la boîte enregistrée" }),
  ).toBeDisabled();
});

test("réservé aux administrateurs", async ({ page }) => {
  await mockApi(page, { role: "ADVISOR" });
  await open(page);
  await expect(page.getByText("réservée aux administrateurs")).toBeVisible();
});

test("configurer une boîte depuis la console : détection, test, dossier, enregistrement", async ({
  page,
}) => {
  const saved: unknown[] = [];
  await mockApi(page, { saved });
  await open(page);
  const form = page.getByRole("region", {
    name: "Paramètres de la boîte email",
  });
  await form.getByLabel("Adresse de la boîte").fill("contact@ecole.example");
  await form.getByLabel("Mot de passe").fill("secret-123");
  await form.getByRole("button", { name: "Détecter les serveurs" }).click();
  await expect(form.getByText(/OVHcloud/)).toBeVisible();
  await expect(form.getByLabel("Serveur IMAP (réception)")).toHaveValue(
    "ssl0.ovh.net",
  );
  await form.getByRole("button", { name: "Tester ces paramètres" }).click();
  await expect(
    form.getByLabel("Résultat du test des paramètres"),
  ).toContainText("IMAP : ✓ connecté");
  await form
    .getByLabel("Dossier surveillé")
    .selectOption({ label: "Programmé" });
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(form.getByText(/Boîte enregistrée/)).toBeVisible();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    address: "contact@ecole.example",
    password: "secret-123",
    imap_host: "ssl0.ovh.net",
    imap_folder: "Programm&AOk-",
    sandbox_recipients: ["moi@example.com"],
  });
});

test("brancher Google Agenda : mode, application OAuth et agenda par défaut", async ({
  page,
}) => {
  const saved: unknown[] = [];
  await mockApi(page, { saved });
  await open(page);
  const card = page.getByRole("region", { name: "Agenda" });
  await card.getByLabel("Mode").selectOption("google");
  await expect(
    card.getByText("/api/v1/calendar/google/callback"),
  ).toBeVisible();
  await card
    .getByLabel("Identifiant client OAuth Google")
    .fill("cid.apps.googleusercontent.com");
  await card.getByLabel("Code secret du client").fill("secret-123");
  await card
    .getByLabel("Agenda par défaut (prospect sans conseiller)")
    .selectOption({ label: "paul" });
  await card.getByRole("button", { name: "Enregistrer l’agenda" }).click();
  await expect(card.getByText(/Agenda enregistré/)).toBeVisible();
  expect(saved).toContainEqual({
    calendar: {
      provider: "google",
      google_client_id: "cid.apps.googleusercontent.com",
      google_client_secret: "secret-123",
      default_user_id: 2,
    },
  });
});

test("brancher le compte Zoom de l'école", async ({ page }) => {
  const saved: unknown[] = [];
  await mockApi(page, { saved });
  await open(page);
  const card = page.getByRole("region", { name: "Zoom" });
  await card.getByLabel("Mode").selectOption("account");
  await card.getByLabel("Account ID").fill("acc-1");
  await card.getByLabel("Client ID").fill("cid-1");
  await card.getByLabel("Client secret").fill("sec-1");
  await card
    .getByLabel("Hôte par défaut (email Zoom, ou « me »)")
    .fill("hote@ecole.fr");
  await card.getByRole("button", { name: "Enregistrer Zoom" }).click();
  await expect(card.getByText(/Zoom enregistré/)).toBeVisible();
  expect(saved).toContainEqual({
    zoom: {
      mode: "account",
      account_id: "acc-1",
      client_id: "cid-1",
      client_secret: "sec-1",
      host_user: "hote@ecole.fr",
    },
  });
});

test("créer un jeton pour le formulaire du site : affiché une seule fois", async ({
  page,
}) => {
  const saved: unknown[] = [];
  await mockApi(page, { saved });
  await open(page);
  const card = page.getByRole("region", { name: "Formulaire et outils" });
  await card.getByLabel("Nom du jeton").fill("Formulaire du site");
  await card.getByLabel("Campagne").selectOption({ label: "Rentrée 2027" });
  await card.getByRole("button", { name: "Créer un jeton" }).click();
  const shown = card.getByRole("status", { name: "Nouveau jeton" });
  await expect(shown.getByText("iag_abcdefSECRET").first()).toBeVisible();
  expect(saved).toContainEqual({
    token: { name: "Formulaire du site", campaign_id: 4, source_id: 9 },
  });
  await shown.getByRole("button", { name: "J’ai copié le jeton" }).click();
  await expect(page.getByText("iag_abcdefSECRET")).toHaveCount(0);
});
