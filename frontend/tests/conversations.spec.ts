import { expect, test, type Page } from "@playwright/test";

const prospect = {
  id: 1,
  first_name: "Marie",
  last_name: "Dupont",
  email: "marie@example.com",
  consent_status: "granted",
  stage: "qualified",
};
const summary = (
  id: string,
  status: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  prospect_id: 1,
  channel: "email",
  status,
  last_message_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  message_count: 2,
  last_message_role: "prospect",
  last_message_preview:
    "Le programme m'intéresse mais je ne sais pas si je peux le financer.",
  handoff: null,
  prospect: {
    id: 1,
    first_name: "Marie",
    last_name: "Dupont",
    email: "marie@example.com",
    stage: "qualified",
    total_score: 80,
    level: "very_hot",
    assigned_advisor_id: null,
  },
  ...over,
});
const conversation = (status: string) => ({
  id: "c1",
  prospect_id: 1,
  channel: "email",
  status,
  summary: null,
  started_at: "2026-10-01T10:00:00Z",
  last_message_at: "2026-10-01T10:05:00Z",
  handoff:
    status === "handed_off"
      ? {
          reason: "question_hors_base",
          summary: "Question sur le financement.",
          pending_question: "Puis-je financer avec mon CPF ?",
          recommended_action: "Répondre sur les financements",
        }
      : null,
  messages: [
    {
      id: "m1",
      role: "prospect",
      content: "Puis-je financer avec mon CPF ?",
      created_at: "2026-10-01T10:00:00Z",
      metadata: {},
    },
  ],
});

type Calls = {
  listQueries: string[];
  posts: { path: string; body: unknown }[];
};

async function mockApi(
  page: Page,
  opts: { role?: string; consent?: string } = {},
) {
  const calls: Calls = { listQueries: [], posts: [] };
  let status = "handed_off";
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
    else if (path === "/conversations") {
      calls.listQueries.push(url.search);
      const wanted = url.searchParams.get("status");
      const handoff =
        status === "handed_off"
          ? { handoff: conversation("handed_off").handoff }
          : {};
      const rows = [summary("c1", status, handoff)].filter(
        (r) =>
          (!wanted || r.status === wanted) &&
          (!url.searchParams.get("channel") ||
            r.channel === url.searchParams.get("channel")),
      );
      body = { items: rows, total: rows.length, limit: 30, offset: 0 };
    } else if (path === "/conversations/c1" && request.method() === "GET")
      body = conversation(status);
    else if (path === "/conversations/c1" && request.method() === "PATCH") {
      status = (request.postDataJSON() as { status: string }).status;
      calls.posts.push({ path, body: request.postDataJSON() });
      body = conversation(status);
    } else if (path === "/conversations/c1/messages") {
      calls.posts.push({ path, body: request.postDataJSON() });
      code = 201;
      body = { created: true };
    } else if (path === "/prospects/1")
      body = {
        ...prospect,
        consent_status: opts.consent ?? "granted",
        campaigns: [],
        profile: {},
      };
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
  return calls;
}

async function open(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("conseiller");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto("/conversations");
}

test("liste, sélection, fiche de transfert et réponse du conseiller", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await open(page);
  const list = page.getByRole("complementary", {
    name: "Liste des conversations",
  });
  await expect(list.getByText("Marie Dupont")).toBeVisible();
  await expect(
    list.getByText("Question hors base de connaissances"),
  ).toBeVisible();
  await expect(list.getByText("il y a 2 h")).toBeVisible();
  await expect(page.getByLabel("1 en attente")).toBeVisible();

  await list.getByRole("button", { name: /Marie Dupont/ }).click();
  const detail = page.getByRole("region", {
    name: "Conversation avec Marie Dupont",
  });
  await expect(detail.getByText("Fiche de transfert")).toBeVisible();
  await expect(
    detail.getByText("Puis-je financer avec mon CPF ?").first(),
  ).toBeVisible();

  await detail
    .getByLabel("Votre réponse")
    .fill("Bonjour Marie, oui le CPF est possible.");
  await detail
    .getByRole("button", { name: "Envoyer en tant que conseiller" })
    .click();
  await expect(detail.getByLabel("Votre réponse")).toHaveValue("");
  expect(calls.posts).toContainEqual({
    path: "/conversations/c1/messages",
    body: {
      role: "advisor",
      content: "Bonjour Marie, oui le CPF est possible.",
    },
  });

  await detail
    .getByRole("button", { name: "Rendre la main à l'agent" })
    .click();
  await expect(
    detail.getByRole("button", { name: "Prendre la main" }),
  ).toBeVisible();
});

test("les filtres sont transmis à l'API", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  await page.getByRole("button", { name: "En attente de vous" }).click();
  await page.getByRole("button", { name: "Moi", exact: true }).click();
  await page.getByLabel("Canal").selectOption("facebook");
  await page.getByLabel("Rechercher une conversation").fill("marie");
  await expect
    .poll(() => new URLSearchParams(calls.listQueries.at(-1)).get("q"))
    .toBe("marie");
  const last = new URLSearchParams(calls.listQueries.at(-1));
  expect(last.get("status")).toBe("handed_off");
  expect(last.get("channel")).toBe("facebook");
  expect(last.get("q")).toBe("marie");
  expect(last.get("advisor_id")).toBe("7");
  await expect(
    page.getByText("Aucune conversation ne correspond"),
  ).toBeVisible();
});

test("observateur : lecture seule", async ({ page }) => {
  await mockApi(page, { role: "VIEWER" });
  await open(page);
  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  await expect(
    page.getByText("Votre accès observateur permet de consulter"),
  ).toBeVisible();
  await expect(page.getByLabel("Votre réponse")).toHaveCount(0);
});

test("prospect désinscrit : réponse impossible", async ({ page }) => {
  await mockApi(page, { consent: "opted_out" });
  await open(page);
  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  await expect(page.getByText("s'est désinscrit")).toBeVisible();
  await expect(page.getByLabel("Votre réponse")).toBeDisabled();
});
