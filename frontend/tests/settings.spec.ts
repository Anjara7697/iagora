import { expect, test, type Page } from "@playwright/test";

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
    } else if (path === "/todo")
      body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
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
});

test("paramètres réservés aux administrateurs", async ({ page }) => {
  await mockApi(page, [], "ADVISOR");
  await login(page);
  await page.goto("/settings");
  await expect(page.getByText("réservée aux administrateurs")).toBeVisible();
});
