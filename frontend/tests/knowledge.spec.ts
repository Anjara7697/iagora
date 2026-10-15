import { expect, test, type Page } from "@playwright/test";

const doc = (over: Record<string, unknown> = {}) => ({
  slug: "ebihar",
  title: "Programme eBIHAR",
  target_code: "ebihar_students",
  chunks: 6,
  embedding_model: "gemini/gemini-embedding-001",
  is_demo: true,
  updated_at: "2026-10-01T10:00:00Z",
  needs_reindex: false,
  ...over,
});

type Calls = { requests: { method: string; path: string; body: unknown }[] };

async function mockApi(
  page: Page,
  opts: { role?: string; configured?: boolean; docs?: unknown[] } = {},
) {
  const calls: Calls = { requests: [] };
  const docs = opts.docs ?? [doc()];
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
        role: opts.role ?? "ADMIN",
        email: "a@example.com",
      };
    else if (path === "/knowledge/status")
      body = {
        configured: opts.configured ?? true,
        embedding_model:
          opts.configured === false ? null : "gemini/gemini-embedding-001",
        min_score: 0.6,
        top_k: 4,
      };
    else if (path === "/knowledge/documents" && request.method() === "GET")
      body = docs;
    else if (
      path === "/knowledge/documents/ebihar" &&
      request.method() === "GET"
    )
      body = {
        ...doc(),
        source_text: "---\ntitle: Programme eBIHAR\n---\n## Durée\n18 mois.",
        sections: [{ heading: "Durée", text: "Le programme dure 18 mois." }],
      };
    else if (
      path.startsWith("/knowledge/documents/") &&
      request.method() !== "GET"
    ) {
      calls.requests.push({
        method: request.method(),
        path,
        body: request.postDataJSON(),
      });
      code = request.method() === "DELETE" ? 204 : 200;
      body =
        request.method() === "DELETE"
          ? null
          : { slug: "nouveau", status: "créé", chunks: 2 };
    } else if (path === "/knowledge/search") {
      calls.requests.push({
        method: "POST",
        path,
        body: request.postDataJSON(),
      });
      body = {
        threshold: 0.6,
        results: [
          {
            source: "Programme eBIHAR / Durée",
            text: "Le programme dure 18 mois.",
            score: 0.846,
            retained: true,
          },
          {
            source: "FAQ / Langue",
            text: "Les cours sont en français.",
            score: 0.497,
            retained: false,
          },
        ],
      };
    } else if (path === "/knowledge/reindex") {
      calls.requests.push({ method: "POST", path, body: null });
      body = { documents: 1 };
    } else if (path === "/todo")
      body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else code = 404;
    await route.fulfill(
      code === 204 ? { status: 204 } : { status: code, json: body },
    );
  });
  return calls;
}

async function open(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.goto("/knowledge");
}

test("liste des documents, détail et marque « Fictif »", async ({ page }) => {
  await mockApi(page);
  await open(page);
  await expect(
    page.getByText("gemini/gemini-embedding-001").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Programme eBIHAR" }),
  ).toBeVisible();
  await expect(page.getByText("Fictif", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Programme eBIHAR" }).click();
  const detail = page.getByRole("region", { name: "Document ebihar" });
  await expect(detail.getByText("Le programme dure 18 mois.")).toBeVisible();
});

test("tester une question affiche les scores et le verdict du seuil", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await open(page);
  await page
    .getByLabel("Question du prospect")
    .fill("Combien de temps dure le programme ?");
  await page.getByRole("button", { name: "Tester" }).click();
  await expect(page.getByText("0.846")).toBeVisible();
  await expect(page.getByText("Retenu", { exact: true })).toBeVisible();
  await expect(page.getByText("Écarté (sous le seuil)")).toBeVisible();
  await expect
    .poll(() => calls.requests)
    .toContainEqual({
      method: "POST",
      path: "/knowledge/search",
      body: {
        query: "Combien de temps dure le programme ?",
        target_code: "ebihar_students",
        limit: 6,
      },
    });
});

test("l'administrateur ajoute un document", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  await page.getByRole("button", { name: "Ajouter un document" }).click();
  await page.getByLabel("Identifiant du document").fill("Mon Nouveau Doc");
  await expect(page.getByLabel("Identifiant du document")).toHaveValue(
    "mon-nouveau-doc",
  );
  await page
    .getByLabel("Contenu du document")
    .fill("---\ntitle: Nouveau\n---\n## A\nUn fait.");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Document enregistré.")).toBeVisible();
  await expect
    .poll(() => calls.requests)
    .toContainEqual({
      method: "PUT",
      path: "/knowledge/documents/mon-nouveau-doc",
      body: { content: "---\ntitle: Nouveau\n---\n## A\nUn fait." },
    });
});

test("la suppression demande confirmation", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Supprimer" }).click();
  expect(calls.requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByText("Document supprimé.")).toBeVisible();
  expect(calls.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
});

test("un conseiller consulte et teste, sans modifier", async ({ page }) => {
  await mockApi(page, { role: "ADVISOR" });
  await open(page);
  await expect(
    page.getByRole("button", { name: "Ajouter un document" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Supprimer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tester" })).toBeVisible();
});

test("embeddings non configurés : avertissement et recherche bloquée", async ({
  page,
}) => {
  await mockApi(page, { configured: false });
  await open(page);
  await expect(
    page.getByText("Les embeddings ne sont pas configurés"),
  ).toBeVisible();
  await page.getByLabel("Question du prospect").fill("une question");
  await expect(page.getByRole("button", { name: "Tester" })).toBeDisabled();
});

test("documents à recalculer : bannière et recalcul", async ({ page }) => {
  const calls = await mockApi(page, {
    docs: [doc({ needs_reindex: true, embedding_model: "ancien/modele" })],
  });
  await open(page);
  await expect(page.getByText("vectorisés avec un autre modèle")).toBeVisible();
  await page.getByRole("button", { name: "Recalculer les vecteurs" }).click();
  await expect(page.getByText("Vecteurs recalculés.")).toBeVisible();
  expect(calls.requests.some((r) => r.path === "/knowledge/reindex")).toBe(
    true,
  );
});

test("bannière de lacune, filtre par programme et statut de chaque document", async ({
  page,
}) => {
  await mockApi(page, {
    docs: [
      doc(),
      doc({
        slug: "master",
        title: "Master eBIHAR",
        target_code: "master_candidates",
        needs_reindex: true,
      }),
    ],
  });
  await page.route("**/api/v1/todo**", (route) =>
    route.fulfill({
      json: { items: [], total: 2, limit: 1, offset: 0, counts: { kb_gap: 1 } },
    }),
  );
  await open(page);
  await expect(
    page.getByText("1 lacune bloque une réponse en cours"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Traiter la demande" }),
  ).toHaveAttribute("href", "/todo");
  await expect(page.getByText("À recalculer").first()).toBeVisible();
  await expect(page.getByText("À jour").first()).toBeVisible();
  const filter = page.getByRole("group", { name: "Programme" });
  await filter
    .getByRole("button", { name: "Master eBIHAR — candidats" })
    .click();
  await expect(
    page.getByRole("button", { name: "Programme eBIHAR" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("table").getByRole("button", { name: "Master eBIHAR" }),
  ).toBeVisible();
});
