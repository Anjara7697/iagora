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
  opts: {
    mode?: string;
    auto?: boolean;
    nextRun?: Record<string, unknown>;
  } = {},
) {
  const messages: Msg[] = [];
  const posts: { path: string; body: unknown }[] = [];
  let consent = "unknown";
  let runs = 0;
  let lastRun: Record<string, unknown> | null = null;
  const agentReply = (result: Record<string, unknown>) =>
    messages.push({
      id: `a${runs}`,
      role: "agent",
      content: String(result.reply),
      created_at: "2026-10-01T10:00:01Z",
      metadata: { sources: ["Programme eBIHAR / Durée"], confidence: 0.9 },
    });
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
    else if (path === "/simulation/sessions") {
      posts.push({ path, body: request.postDataJSON() });
      body = {
        prospect_id: 5,
        conversation_id: "c1",
        guide: [
          "Comment se déroule le programme ?",
          "Je voudrais un rendez-vous.",
        ],
      };
    } else if (path === "/simulation/c1/messages") {
      const payload = request.postDataJSON() as { content: string };
      posts.push({ path, body: payload });
      messages.push({
        id: `m${messages.length}`,
        role: "prospect",
        content: payload.content,
        created_at: "2026-10-01T10:00:00Z",
        metadata: {},
      });
      if (payload.content.startsWith("STOP")) {
        consent = "opted_out";
        for (const m of messages) {
          const draft = m.metadata.draft as { status?: string } | undefined;
          if (draft?.status === "pending") draft.status = "cancelled";
        }
        await route.fulfill({ json: {} });
        return;
      }
      runs += 1;
      lastRun = run({ run_id: `r${runs}` });
      messages.push({
        id: `a${runs}`,
        role: "agent",
        content: String(lastRun.reply),
        created_at: "2026-10-01T10:00:01Z",
        metadata: { delivery: "draft", draft: { status: "pending" } },
      });
      body = {};
    } else if (path === "/simulation/c1/report") {
      body = {
        guide: [],
        exchange: {
          messages: messages.filter(
            (m) => m.role === "prospect" || m.metadata.delivery === "simulated",
          ),
        },
        appointments: [],
        limits: ["Pas de transport email réel"],
        model_validation: "Qualité commerciale à confirmer",
      };
    } else if (path.startsWith("/simulation/c1/drafts/")) {
      posts.push({ path, body: {} });
      const m = messages[messages.length - 1];
      (m.metadata.draft as { status: string }).status = "approved";
      m.metadata.delivery = "simulated";
      body = {};
    } else if (path === "/prospects" && request.method() === "POST") {
      posts.push({ path, body: request.postDataJSON() });
      code = 201;
      body = { prospect: { id: 5 } };
    } else if (path === "/prospects/5")
      body = {
        id: 5,
        first_name: "Camille",
        consent_status: consent,
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
      if (opts.auto) {
        // Déclenchement automatique : l'agent répond dès que le message est enregistré.
        runs += 1;
        lastRun = run({ run_id: `r${runs}`, ...(opts.nextRun ?? {}) });
        agentReply(lastRun);
      }
      code = 201;
      body = { created: true };
    } else if (path === "/agent/runs" && opts.auto) {
      code = 409;
      body = { detail: "Aucun message du prospect à traiter" };
    } else if (path === "/prospects/5/agent-runs")
      body = lastRun ? [lastRun] : [];
    else if (path === "/agent/runs") {
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

test("déclenchement automatique : la décision de l'agent est reprise sans erreur", async ({
  page,
}) => {
  await mockApi(page, { auto: true, mode: "auto" });
  await start(page);
  await page.getByLabel("Message du prospect").fill("Bonjour");
  await page.getByRole("button", { name: "Envoyer" }).click();
  const decision = page.getByRole("complementary", {
    name: "Décision de l'agent",
  });
  await expect(decision.getByText("Poursuivre l'échange")).toBeVisible();
  await expect(page.getByText("Aucun message du prospect")).toHaveCount(0);
  await expect(
    page.getByText("Le programme dure 18 mois.").first(),
  ).toBeVisible();
});

test("mode démo : bandeau permanent et purge des données fictives avec confirmation", async ({
  page,
}) => {
  await mockApi(page);
  let purged = false;
  await page.route("**/api/v1/demo**", async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") {
      purged = true;
      await route.fulfill({ json: { prospects: 3, conversations: 2 } });
    } else {
      await route.fulfill({
        json: { prospects: purged ? 0 : 3, conversations: purged ? 0 : 2 },
      });
    }
  });
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto("/simulator");
  await expect(page.getByRole("note")).toContainText("MODE DÉMO");
  await expect(page.getByRole("note")).toContainText("aucun message");
  await expect(
    page.getByText("3 prospect(s), 2 conversation(s)"),
  ).toBeVisible();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page
    .getByRole("button", { name: "Supprimer les données fictives" })
    .click();
  expect(purged).toBe(false);
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Supprimer les données fictives" })
    .click();
  await expect(
    page.getByText("3 prospect(s) fictif(s) et 2 conversation(s) supprimés."),
  ).toBeVisible();
});

test("parcours guidé : le prospect ne voit la réponse qu’après validation", async ({
  page,
}, testInfo) => {
  const posts = await mockApi(page);
  await start(page);
  await page.getByRole("button", { name: "Ouvrir le parcours guidé" }).click();
  await page
    .getByRole("button", { name: "Démarrer le parcours guidé" })
    .click();
  await page.getByRole("button", { name: /Étape 1/ }).click();
  await page.getByRole("button", { name: "Envoyer au vrai agent" }).click();
  const operator = page.getByRole("region", { name: "Échange opérateur" });
  const mailbox = page.getByRole("region", { name: "Boîte du prospect" });
  await expect(
    operator.getByText("Le programme dure 18 mois.", { exact: true }),
  ).toBeVisible();
  await expect(mailbox.getByText(/Le programme dure 18 mois/)).toHaveCount(0);
  await operator
    .getByRole("button", { name: "Valider et livrer dans la boîte fictive" })
    .click();
  await expect(mailbox.getByText(/Le programme dure 18 mois/)).toBeVisible();
  await expect(
    operator.getByText("Reçu dans la boîte fictive", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("guided-simulation.png"),
    fullPage: true,
  });
  expect(posts.some((p) => p.path === "/simulation/c1/messages")).toBeTruthy();
  expect(posts.some((p) => p.path === "/agent/runs")).toBeFalsy();
});

test("parcours guidé : erreur de création visible et nouvelle tentative possible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await start(page);
  await page.getByRole("button", { name: "Ouvrir le parcours guidé" }).click();
  await page.route("**/api/v1/simulation/sessions", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Service temporairement indisponible" },
    }),
  );
  await page
    .getByRole("button", { name: "Démarrer le parcours guidé" })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Service temporairement indisponible",
  );
  await expect(
    page.getByRole("button", { name: "Démarrer le parcours guidé" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("parcours guidé : STOP arrête la saisie même si la conversation reste ouverte", async ({
  page,
}) => {
  await mockApi(page);
  await start(page);
  await page.getByRole("button", { name: "Ouvrir le parcours guidé" }).click();
  await page
    .getByRole("button", { name: "Démarrer le parcours guidé" })
    .click();
  await page.getByRole("button", { name: /Étape 1/ }).click();
  await page.getByRole("button", { name: "Envoyer au vrai agent" }).click();
  await expect(
    page.getByText("Brouillon invisible pour le prospect", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Message du prospect").fill("STOP, ne m’écrivez plus");
  await page.getByRole("button", { name: "Envoyer au vrai agent" }).click();
  await expect(
    page.getByText("Parcours arrêté : prospect désinscrit"),
  ).toBeVisible();
  await expect(page.getByLabel("Message du prospect")).toBeDisabled();
  await expect(
    page
      .getByRole("region", { name: "Boîte du prospect" })
      .getByText(/Le programme dure 18 mois/),
  ).toHaveCount(0);
});
