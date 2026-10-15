import { expect, test, type Page } from "@playwright/test";

const prospect = {
  id: 1,
  first_name: "Marie",
  last_name: "Dupont",
  email: "marie@example.com",
  stage: "qualified",
  total_score: 80,
  level: "very_hot",
  assigned_advisor_id: null,
};
const draftItem = {
  id: "draft:c1:m1",
  kind: "validation",
  priority: "high",
  conversation_id: "c1",
  prospect,
  channel: "email",
  title: "Brouillon de réponse à valider",
  detail: "Je ne sais pas si je peux financer.",
  created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  draft: {
    message_id: "m1",
    content: "Bonjour Marie, le financement est possible.",
    sources: ["Financement & OPCO v3"],
    confidence: 0.91,
    created_at: "2026-10-01T10:00:00Z",
  },
  handoff: null,
  recommendation: {
    action: "Valider ou modifier la réponse de l'agent",
    reason: "Objection financement détectée",
    risk: "low",
    confidence: 0.91,
    sources: ["Financement & OPCO v3"],
  },
};
const gapItem = {
  id: "handoff:c2",
  kind: "kb_gap",
  priority: "medium",
  conversation_id: "c2",
  prospect: {
    ...prospect,
    id: 2,
    first_name: "Ahmed",
    last_name: "Belkacem",
    level: "warm",
  },
  channel: "email",
  title: "Lacune de la base de connaissances",
  detail: "Le certificat est-il reconnu par l'État ?",
  created_at: new Date(Date.now() - 4 * 3600_000).toISOString(),
  draft: null,
  handoff: {
    reason: "question_hors_base",
    summary: "Question sans extrait validé.",
    pending_question: "Le certificat est-il reconnu par l'État ?",
    recommended_action: "Répondre à la question",
    identity: {},
  },
  recommendation: {
    action: "Répondre à la question",
    reason: "Question sans extrait validé.",
    risk: "medium",
    confidence: null,
    sources: [],
  },
};

type Calls = { posts: { path: string; method: string; body: unknown }[] };

async function mockApi(
  page: Page,
  opts: { role?: string; mode?: string } = {},
) {
  const calls: Calls = { posts: [] };
  let items = [draftItem, gapItem];
  let mode = opts.mode ?? "assisted";
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me")
      body = {
        id: 7,
        username: "conseiller",
        role: opts.role ?? "ADVISOR",
        email: "c@example.com",
      };
    else if (path === "/todo") {
      const kind = url.searchParams.get("kind");
      const rows = items.filter((i) => !kind || i.kind === kind);
      const counts: Record<string, number> = {};
      for (const i of items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
      body = { items: rows, total: rows.length, limit: 100, offset: 0, counts };
    } else if (path === "/agent/mode" && request.method() === "GET")
      body = { mode };
    else if (path === "/agent/mode") {
      mode = (request.postDataJSON() as { mode: string }).mode;
      calls.posts.push({ path, method: "PUT", body: request.postDataJSON() });
      body = { mode };
    } else if (path.startsWith("/conversations/c1/drafts/m1/")) {
      const action = path.split("/").pop();
      calls.posts.push({
        path,
        method: request.method(),
        body: request.postDataJSON(),
      });
      if (action === "approve" || action === "reject")
        items = items.filter((i) => i.id !== draftItem.id);
      code = action === "regenerate" ? 201 : 200;
      body = { ok: true };
    } else code = 404;
    await route.fulfill({ status: code, json: body });
  });
  return calls;
}

async function open(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("conseiller");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto("/todo");
}

test("file triée, filtres par type, recommandation et brouillon", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  const list = page.getByRole("complementary", { name: "Éléments à traiter" });
  await expect(list.getByText("Marie Dupont")).toBeVisible();
  await expect(list.getByText("Ahmed Belkacem")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tout (2)" })).toBeVisible();
  await expect(page.getByLabel("2 en attente")).toBeVisible();

  await page.getByRole("button", { name: "Lacune KB (1)" }).click();
  await expect(list.getByText("Marie Dupont")).toHaveCount(0);
  await page.getByRole("button", { name: /^Tout/ }).click();

  await list.getByRole("button", { name: /Marie Dupont/ }).click();
  const detail = page.getByRole("region", { name: "À traiter : Marie Dupont" });
  await expect(detail.getByText("Prochaine action recommandée")).toBeVisible();
  await expect(detail.getByText("Financement & OPCO v3").first()).toBeVisible();
  await expect(detail.getByLabel("Confiance 91 %")).toBeVisible();
  await expect(
    detail.getByText("Bonjour Marie, le financement est possible."),
  ).toBeVisible();
});

test("approuver une version modifiée envoie le texte au serveur", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await open(page);
  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page
    .getByLabel("Texte du brouillon")
    .fill("Bonjour Marie, version relue.");
  await page
    .getByRole("button", { name: "Approuver la version modifiée" })
    .click();
  await expect(page.getByText("Nouveau")).toHaveCount(0);
  expect(calls.posts).toContainEqual({
    path: "/conversations/c1/drafts/m1/approve",
    method: "POST",
    body: { content: "Bonjour Marie, version relue." },
  });
  await expect(page.getByRole("button", { name: /Marie Dupont/ })).toHaveCount(
    0,
  );
});

test("refuser exige un motif ; régénérer appelle l'agent", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect
    .poll(() => calls.posts.some((p) => p.path.endsWith("/regenerate")))
    .toBe(true);

  await page.getByRole("button", { name: "Refuser (motif)" }).click();
  const confirm = page.getByRole("button", { name: "Confirmer le refus" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Motif du refus").fill("Ton trop familier");
  await confirm.click();
  expect(calls.posts).toContainEqual({
    path: "/conversations/c1/drafts/m1/reject",
    method: "POST",
    body: { reason: "Ton trop familier" },
  });
});

test("observateur : consultation seule", async ({ page }) => {
  await mockApi(page, { role: "VIEWER" });
  await open(page);
  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  await expect(
    page.getByText(
      "Votre accès observateur permet de consulter les brouillons.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approuver" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Arrêt d'urgence/ }),
  ).toHaveCount(0);
});

test("arrêt d'urgence et reprise du mode assisté", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  await expect(page.getByText("Agent — Mode assisté")).toBeVisible();
  await page.getByRole("button", { name: /Arrêt d'urgence/ }).click();
  await expect(page.getByText("Agent — Arrêt d'urgence")).toBeVisible();
  expect(calls.posts).toContainEqual({
    path: "/agent/mode",
    method: "PUT",
    body: { mode: "manual" },
  });
  await page.getByRole("button", { name: "Reprendre en mode assisté" }).click();
  await expect(page.getByText("Agent — Mode assisté")).toBeVisible();
});
