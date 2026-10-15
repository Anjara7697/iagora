import { expect, test, type Page } from "@playwright/test";

type Msg = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

const run = (over: Record<string, unknown> = {}) => ({
  run_id: "r1",
  prospect_id: 5,
  conversation_id: "c1",
  trigger: "inbound_message",
  action: "continue_conversation",
  reason: "Poursuite de l'échange et qualification",
  outcome: "continue_conversation",
  reply: "Le programme dure 18 mois.",
  handoff_reason: null,
  stage_before: "new",
  stage_after: "in_conversation",
  scores: { interest: 13, fit: 0, total: 8, level: "cold" },
  llm: { provider: "gemini", model: "test" },
  trace: [
    {
      node: "load_prospect",
      summary: "prospect 5",
      at: "2026-10-01T10:00:00Z",
    },
  ],
  started_at: "2026-10-01T10:00:00Z",
  ...over,
});

async function mockApi(
  page: Page,
  opts: { mode?: string; nextRun?: Record<string, unknown> } = {},
) {
  const messages: Msg[] = [];
  const posts: { path: string; body: unknown }[] = [];
  let runs = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me")
      body = {
        id: 1,
        username: "admin",
        role: "ADMIN",
        email: "a@example.com",
      };
    else if (path === "/agent/mode") body = { mode: opts.mode ?? "assisted" };
    else if (path === "/campaigns")
      body = {
        items: [
          {
            id: 3,
            name: "Recrutement eBIHAR",
            status: "active",
            targets: [
              { id: 1, code: "ebihar_students", name: "Étudiants eBIHAR" },
            ],
            sources: [{ id: 9, name: "LinkedIn" }],
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      };
    else if (path === "/prospects" && request.method() === "POST") {
      posts.push({ path, body: request.postDataJSON() });
      code = 201;
      body = { prospect: { id: 5 } };
    } else if (path === "/prospects/5")
      body = {
        id: 5,
        first_name: "Camille",
        consent_status: "unknown",
        profile: {},
        campaigns: [
          { id: 1, conversion_stage: "in_conversation", total_score: 8 },
        ],
      };
    else if (path === "/conversations" && request.method() === "POST") {
      code = 201;
      body = { conversation: { id: "c1" } };
    } else if (path === "/conversations/c1" && request.method() === "GET")
      body = { id: "c1", messages };
    else if (path === "/conversations/c1/messages") {
      const payload = request.postDataJSON() as { content: string };
      posts.push({ path, body: payload });
      messages.push({
        id: `m${messages.length}`,
        role: "prospect",
        content: payload.content,
        created_at: "2026-10-01T10:00:00Z",
        metadata: {},
      });
      code = 201;
      body = { created: true };
    } else if (path === "/agent/runs") {
      runs += 1;
      const result = run({ run_id: `r${runs}`, ...(opts.nextRun ?? {}) });
      messages.push({
        id: `a${runs}`,
        role: "agent",
        content: String(result.reply),
        created_at: "2026-10-01T10:00:01Z",
        metadata: {
          sources: ["Programme eBIHAR / Durée"],
          confidence: 0.9,
          draft: opts.mode === "auto" ? undefined : { status: "pending" },
        },
      });
      code = 201;
      body = result;
    } else if (path.includes("/drafts/")) {
      posts.push({ path, body: request.postDataJSON() });
      (
        messages[messages.length - 1].metadata.draft as { status: string }
      ).status = "approved";
      body = { ok: true };
    } else code = 404;
    await route.fulfill({ status: code, json: body });
  });
  return posts;
}

async function start(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto("/simulator");
  await page.getByRole("button", { name: "Créer un prospect fictif" }).click();
}

test("message type, décision, brouillon et approbation", async ({ page }) => {
  const posts = await mockApi(page);
  await start(page);
  await expect(page.getByText("En conversation").first()).toBeVisible();

  await page.getByRole("button", { name: "Durée", exact: true }).click();
  await expect(page.getByLabel("Message du prospect")).toHaveValue(
    "Combien de temps dure le programme ?",
  );
  await page.getByRole("button", { name: "Envoyer" }).click();

  const decision = page.getByRole("complementary", {
    name: "Décision de l'agent",
  });
  await expect(decision.getByText("Poursuivre l'échange")).toBeVisible();
  await expect(decision.getByText("Programme eBIHAR / Durée")).toBeVisible();
  await expect(decision.getByText("90 %")).toBeVisible();
  await expect(
    page.getByText("Brouillon de l'agent en attente de validation"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Approuver" }).click();
  await expect(
    page.getByText("Brouillon de l'agent en attente de validation"),
  ).toHaveCount(0);
  expect(posts.some((p) => p.path.endsWith("/approve"))).toBe(true);
  expect(posts[0]).toEqual({
    path: "/prospects",
    body: expect.objectContaining({
      target_code: "ebihar_students",
      campaign_id: 3,
    }),
  });
});

test("fin de conversation : saisie bloquée", async ({ page }) => {
  await mockApi(page, {
    nextRun: { action: "human_handoff", handoff_reason: "demande_conseiller" },
  });
  await start(page);
  await page.getByRole("button", { name: "Veut un conseiller" }).click();
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("Conversation terminée")).toBeVisible();
  await expect(page.getByLabel("Message du prospect")).toBeDisabled();
});

test("plusieurs tours : consulter la décision d'un tour précédent", async ({
  page,
}) => {
  await mockApi(page);
  await start(page);
  for (const text of ["Bonjour", "Merci"]) {
    await page.getByLabel("Message du prospect").fill(text);
    await page.getByRole("button", { name: "Envoyer" }).click();
    await expect(page.getByRole("button", { name: /Tour/ }).last())
      .toBeVisible()
      .catch(() => undefined);
  }
  const tours = page.getByRole("group", { name: "Tours" });
  await expect(tours.getByRole("button")).toHaveCount(2);
  await tours.getByRole("button", { name: "Tour 1" }).click();
  await expect(tours.getByRole("button", { name: "Tour 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("arrêt d'urgence : avertissement", async ({ page }) => {
  await mockApi(page, { mode: "manual" });
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto("/simulator");
  await expect(page.getByText("Arrêt d'urgence actif")).toBeVisible();
});
