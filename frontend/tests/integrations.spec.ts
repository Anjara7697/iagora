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

async function mockApi(
  page: Page,
  opts: { role?: string; status?: unknown; check?: unknown } = {},
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
  await expect(card.getByText(/n’écrit qu’à : moi@example.com/)).toBeVisible();
  await expect(card.getByText("Prêt à envoyer :")).toBeVisible();
});

test("tester la connexion affiche IMAP et SMTP", async ({ page }) => {
  const calls = await mockApi(page, {
    check: { imap: "IMAP : identifiants refusés", smtp: "ok" },
  });
  await open(page);
  await page.getByRole("button", { name: "Tester la connexion" }).click();
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
    page.getByRole("button", { name: "Tester la connexion" }),
  ).toBeDisabled();
});

test("réservé aux administrateurs", async ({ page }) => {
  await mockApi(page, { role: "ADVISOR" });
  await open(page);
  await expect(page.getByText("réservée aux administrateurs")).toBeVisible();
});
