import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

async function mockApi(
  page: Page,
  calendar: Record<string, unknown>,
  calls: string[] = [],
  zoom: Record<string, unknown> = { mode: "none", connected: false },
) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me")
      body = {
        id: 2,
        username: "paul",
        email: "paul@example.com",
        role: "ADVISOR",
        must_change_password: false,
      };
    else if (path === "/calendar/me" && request.method() === "DELETE") {
      calls.push("delete");
      await route.fulfill({ status: 204, body: "" });
      return;
    } else if (path === "/calendar/me") body = calendar;
    else if (path === "/zoom/me") body = zoom;
    else if (path === "/zoom/connect") {
      calls.push("zoom-connect");
      body = { url: "https://zoom.us/oauth/authorize?x=1" };
    } else if (path === "/calendar/google/connect") {
      calls.push(`connect:${request.postDataJSON().return_to}`);
      body = { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" };
    } else if (path === "/todo")
      body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
  await page.route("https://zoom.us/**", (route) =>
    route.fulfill({
      status: 200,
      body: "<h1>Zoom</h1>",
      contentType: "text/html",
    }),
  );
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      body: "<h1>Google</h1>",
      contentType: "text/html",
    }),
  );
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("paul");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("le conseiller connecte son agenda Google depuis Mon compte", async ({
  page,
}) => {
  const calls: string[] = [];
  await mockApi(page, { available: true, connected: false }, calls);
  await login(page);
  await page.goto("/account");
  const section = page.getByRole("region", { name: "Mon agenda" });
  await section
    .getByRole("button", { name: "Connecter mon agenda Google" })
    .click();
  await expect(page).toHaveURL(/accounts\.google\.com/);
  expect(calls[0]).toMatch(/^connect:http:\/\/[^/]+:3100\/account$/);
});

test("retour de Google : agenda connecté, puis déconnexion", async ({
  page,
}) => {
  const calls: string[] = [];
  await mockApi(
    page,
    {
      available: true,
      connected: true,
      account_email: "paul@gmail.com",
      connected_at: "2026-10-23T10:00:00Z",
      last_error: null,
    },
    calls,
  );
  await login(page);
  await page.goto("/account?calendar=connected");
  const section = page.getByRole("region", { name: "Mon agenda" });
  await expect(section.getByText("Agenda Google connecté.")).toBeVisible();
  await expect(section.getByText("paul@gmail.com")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await section.getByRole("button", { name: "Déconnecter" }).click();
  await expect.poll(() => calls).toContain("delete");
  await auditA11y(page, "mon compte");
});

test("agenda pas encore branché par l'administrateur", async ({ page }) => {
  await mockApi(page, { available: false, connected: false });
  await login(page);
  await page.goto("/account");
  await expect(
    page.getByText(/pas encore branché par l’administrateur/),
  ).toBeVisible();
});

test("mode Zoom par conseiller : connecter son compte Zoom", async ({
  page,
}) => {
  const calls: string[] = [];
  await mockApi(page, { available: false, connected: false }, calls, {
    mode: "advisor",
    connected: false,
  });
  await login(page);
  await page.goto("/account");
  const section = page.getByRole("region", { name: "Mon Zoom" });
  await section
    .getByRole("button", { name: "Connecter mon compte Zoom" })
    .click();
  await expect(page).toHaveURL(/zoom\.us/);
  expect(calls).toContain("zoom-connect");
});

test("compte Zoom de l'école : pas de section Mon Zoom", async ({ page }) => {
  await mockApi(page, { available: false, connected: false }, [], {
    mode: "account",
    connected: false,
  });
  await login(page);
  await page.goto("/account");
  await expect(page.getByRole("region", { name: "Mon agenda" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mon Zoom" })).toHaveCount(0);
});
