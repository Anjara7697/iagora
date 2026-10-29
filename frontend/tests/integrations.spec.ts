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

const meta = {
  configured: false,
  enabled: false,
  app_id: "",
  api_version: "v24.0",
  app_secret_set: false,
  page_access_token_set: false,
  verify_token_set: false,
  mappings: [],
  webhook_path: "/api/v1/webhooks/meta",
  last_event_at: null,
  last_success_at: null,
  last_error: null,
  received: 0,
  processed: 0,
  failed: 0,
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
  let metaState = { ...meta };
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
    } else if (path === "/integrations/meta") {
      if (request.method() === "PUT") {
        const sent = request.postDataJSON();
        opts.saved?.push({ meta: sent });
        metaState = {
          ...metaState,
          ...sent,
          configured: true,
          app_secret_set: true,
          page_access_token_set: true,
          verify_token_set: true,
        };
        body = metaState;
      } else body = metaState;
    } else if (path === "/integrations/meta/simulate") {
      opts.saved?.push({ metaSimulation: request.postDataJSON() });
      body = { prospect_id: 42, created: true, duplicate: false };
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

/** Ouvre le panneau d'un connecteur depuis le catalogue (et un onglet, s'il y en a). */
async function openConnector(page: Page, name: string, tab?: string) {
  await page
    .getByRole("button", { name: new RegExp(`^(Configurer|Gérer) ${name}$`) })
    .click();
  const drawer = page.getByRole("dialog", { name });
  await expect(drawer).toBeVisible();
  if (tab) await drawer.getByRole("tab", { name: tab }).click();
  return drawer;
}

test("le catalogue résume l'état de chaque connecteur sans aucun secret", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  const email = page.getByRole("article", { name: "Messagerie email" });
  await expect(email.getByText("Configurée")).toBeVisible();
  await expect(email.getByText(/Dernière relève/)).toBeVisible();
  for (const name of ["Agenda des conseillers", "Zoom"])
    await expect(
      page.getByRole("article", { name }).getByText("Non branché"),
    ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Formulaire du site et outils" })
      .getByText("Aucun jeton"),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Meta Lead Ads" }).getByText("Non configuré"),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "LinkedIn Lead Gen" }).getByText("Bientôt"),
  ).toBeVisible();
  await expect(page.getByText("iag_")).toHaveCount(0);
});

test("l'état détaillé de la boîte email est dans son panneau", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  const drawer = await openConnector(page, "Messagerie email");
  await expect(drawer.getByText("Envoi désactivé")).toBeVisible();
  await expect(drawer.getByText("Réception active")).toBeVisible();
  await expect(drawer.getByText(/agent@datum.test/).first()).toBeVisible();
  await expect(drawer.getByText(/n’écrit qu’à moi@example.com/)).toBeVisible();
  await expect(drawer.getByText("Prêt à envoyer")).toBeVisible();
  await expect(drawer.getByText("À tester", { exact: true })).toBeVisible();
});

test("un seul onglet de la messagerie est affiché à la fois", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  const drawer = await openConnector(page, "Messagerie email");
  await expect(drawer.getByText("Réception active")).toBeVisible();
  await expect(drawer.getByLabel("Adresse de la boîte")).toBeHidden();
  await drawer.getByRole("tab", { name: "Configuration" }).click();
  await expect(drawer.getByLabel("Adresse de la boîte")).toBeVisible();
  await expect(drawer.getByText("Réception active")).toBeHidden();
});

test("rechercher et filtrer les connecteurs", async ({ page }) => {
  await mockApi(page);
  await open(page);
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(7);
  await page.getByLabel("Rechercher un connecteur").fill("zoom");
  await expect(cards).toHaveCount(1);
  await page.getByLabel("Rechercher un connecteur").fill("introuvable");
  await expect(page.getByText(/Aucun connecteur ne correspond/)).toBeVisible();
  await page.getByLabel("Rechercher un connecteur").fill("");
  await page.getByRole("button", { name: "Bientôt", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "Configurés", exact: true }).click();
  await expect(cards).toHaveCount(2); // messagerie + import CSV
  await page.getByRole("button", { name: "À configurer", exact: true }).click();
  await expect(cards).toHaveCount(4); // agenda, Zoom, jetons, Meta
});

test("le panneau est adressable, se ferme avec Échap et rend le focus", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  const opener = page.getByRole("button", { name: "Configurer Zoom" });
  await opener.click();
  await expect(page).toHaveURL(/\?c=zoom/);
  await expect(page.getByRole("dialog", { name: "Zoom" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fermer" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/\?c=/);
  await expect(opener).toBeFocused();
  // Un lien direct rouvre le panneau.
  await page.goto("/integrations?c=calendar");
  await expect(
    page.getByRole("dialog", { name: "Agenda des conseillers" }),
  ).toBeVisible();
});

test("les connecteurs pas encore branchés expliquent pourquoi", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  await page
    .getByRole("button", { name: "En savoir plus LinkedIn Lead Gen" })
    .click();
  const drawer = page.getByRole("dialog", { name: "LinkedIn Lead Gen" });
  await expect(
    drawer.getByText(/accès à l’API LinkedIn/),
  ).toBeVisible();
  await expect(drawer.getByRole("textbox")).toHaveCount(0);
});

test("configure Meta, associe un formulaire et simule un lead", async ({ page }) => {
  const saved: unknown[] = [];
  await mockApi(page, { saved });
  await open(page);
  const drawer = await openConnector(page, "Meta Lead Ads");
  const card = drawer.getByRole("region", { name: "Meta Lead Ads" });
  await card.getByLabel("Identifiant de l’application Meta").fill("app-123");
  await card.getByLabel("Code secret de l’application").fill("app-secret");
  await card.getByLabel("Jeton d’accès de la page").fill("page-token");
  await card.getByLabel("Jeton de vérification du webhook").fill("verify-token");
  await card.getByLabel("Identifiant du formulaire Meta").fill("form-123");
  await card.getByLabel("Nom du formulaire Meta").fill("Formulaire eBIHAR");
  await card.getByLabel("Campagne").selectOption("4");
  await card.getByLabel("Source").selectOption("9");
  await card.getByRole("button", { name: "Ajouter cette correspondance" }).click();
  await card.getByLabel("Activer la réception des leads Meta").check();
  await card.getByRole("button", { name: "Enregistrer Meta" }).click();
  await expect(card.getByText("Configuration Meta enregistrée.")).toBeVisible();
  expect(saved[0]).toMatchObject({
    meta: {
      app_id: "app-123",
      enabled: true,
      app_secret: "app-secret",
      page_access_token: "page-token",
      verify_token: "verify-token",
      mappings: [{ form_id: "form-123", campaign_id: 4, source_id: 9 }],
    },
  });
  await card.getByRole("button", { name: "Créer un lead fictif" }).click();
  await expect(card.getByText("Lead fictif reçu")).toBeVisible();
  await expect(
    card.getByRole("link", { name: "Ouvrir le prospect test" }),
  ).toHaveAttribute("href", "/prospects/42");
});

test("l'import CSV ouvre sa page", async ({ page }) => {
  await mockApi(page);
  await open(page);
  await expect(
    page.getByRole("link", { name: "Ouvrir Import de fichier CSV" }),
  ).toHaveAttribute("href", "/prospects/import");
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
  await openConnector(page, "Messagerie email");
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
  await openConnector(page, "Messagerie email");
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
  await openConnector(page, "Messagerie email");
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
  await expect(
    page
      .getByRole("article", { name: "Messagerie email" })
      .getByText("À configurer"),
  ).toBeVisible();
  const drawer = await openConnector(page, "Messagerie email");
  await expect(drawer.getByText(/Boîte non configurée/)).toBeVisible();
  // Non configurée : le panneau s'ouvre sur la configuration.
  await expect(
    drawer.getByRole("tab", { name: "Configuration" }),
  ).toHaveAttribute("aria-selected", "true");
  await drawer.getByRole("tab", { name: "Vue d’ensemble" }).click();
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
  await openConnector(page, "Messagerie email", "Configuration");
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
  await openConnector(page, "Agenda des conseillers");
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
  await openConnector(page, "Zoom");
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
  await openConnector(page, "Formulaire du site et outils");
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

test("un test réussi de la boîte enregistrée est invalidé après enregistrement", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  const drawer = await openConnector(page, "Messagerie email");
  await drawer
    .getByRole("button", { name: "Tester la boîte enregistrée", exact: true })
    .click();
  await expect(drawer.getByText("Test réussi", { exact: true })).toBeVisible();
  await drawer.getByRole("tab", { name: "Configuration" }).click();
  const form = page.getByRole("region", {
    name: "Paramètres de la boîte email",
    exact: true,
  });
  await form
    .getByLabel("Nom d’expéditeur", { exact: true })
    .fill("Nouvelle équipe");
  await expect(
    form.getByText("Modifications non enregistrées", { exact: true }),
  ).toBeVisible();
  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(
    form.getByText("Modifications non enregistrées", { exact: true }),
  ).toHaveCount(0);
  await drawer.getByRole("tab", { name: "Vue d’ensemble" }).click();
  await expect(drawer.getByText("À tester", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Test réussi", { exact: true })).toHaveCount(0);
});

test("serveurs sur mobile : test périmé retiré et ports enregistrés", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const saved: unknown[] = [];
  await mockApi(page, { saved });
  await open(page);
  await openConnector(page, "Messagerie email", "Configuration");
  const form = page.getByRole("region", {
    name: "Paramètres de la boîte email",
    exact: true,
  });
  await form
    .getByRole("button", { name: "Tester ces paramètres", exact: true })
    .click();
  await expect(
    form.getByLabel("Résultat du test des paramètres"),
  ).toBeVisible();
  await form
    .getByText("Paramètres avancés des serveurs", { exact: true })
    .click();
  await form.getByLabel("Port SMTP", { exact: true }).fill("465");
  await form
    .getByRole("combobox", { name: "Sécurité SMTP", exact: true })
    .selectOption("ssl");
  await expect(form.getByLabel("Résultat du test des paramètres")).toHaveCount(
    0,
  );
  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(
    form.getByText("Boîte enregistrée", { exact: false }),
  ).toBeVisible();
  expect(saved).toContainEqual(
    expect.objectContaining({
      smtp_port: 465,
      smtp_security: "ssl",
      password: null,
    }),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("une opération en cours verrouille les paramètres et les actions de la boîte", async ({
  page,
}) => {
  await mockApi(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/integrations/email/test", async (route) => {
    await gate;
    await route.fulfill({ json: { imap: "ok", smtp: "ok", folders: [] } });
  });
  await open(page);
  await openConnector(page, "Messagerie email", "Configuration");
  const form = page.getByRole("region", {
    name: "Paramètres de la boîte email",
    exact: true,
  });
  await form
    .getByRole("button", { name: "Tester ces paramètres", exact: true })
    .click();
  try {
    await expect(
      form.getByLabel("Adresse de la boîte", { exact: true }),
    ).toBeDisabled();
    // L'action de l'autre onglet est verrouillée aussi, même masquée.
    await expect(
      page.getByRole("button", {
        name: "Tester la boîte enregistrée",
        exact: true,
        includeHidden: true,
      }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    form.getByLabel("Adresse de la boîte", { exact: true }),
  ).toBeEnabled();
});

test("les paramètres de messagerie peuvent être rechargés après une erreur", async ({
  page,
}) => {
  await mockApi(page);
  let ready = false;
  await page.route("**/api/v1/integrations/email/config", (route) =>
    route.fulfill(
      ready
        ? { json: config }
        : { status: 503, json: { detail: "Paramètres indisponibles" } },
    ),
  );
  await open(page);
  await openConnector(page, "Messagerie email", "Configuration");
  await expect(
    page.getByRole("alert").filter({ hasText: "Paramètres indisponibles" }),
  ).toBeVisible();
  ready = true;
  await page
    .getByRole("button", { name: "Réessayer les paramètres", exact: true })
    .click();
  const form = page.getByRole("region", {
    name: "Paramètres de la boîte email",
    exact: true,
  });
  await expect(
    form.getByLabel("Adresse de la boîte", { exact: true }),
  ).toHaveValue(config.address);
  await expect(form.getByLabel("Mot de passe", { exact: true })).toHaveValue(
    "",
  );
});
