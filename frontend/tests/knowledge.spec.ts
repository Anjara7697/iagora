import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

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
  const model = page.getByText("gemini/gemini-embedding-001", { exact: true });
  await expect(model).toBeHidden();
  await page
    .getByText("Réglages techniques de la recherche", { exact: true })
    .click();
  await expect(model).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Programme eBIHAR" }),
  ).toBeVisible();
  await expect(page.getByText("Fictif", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Programme eBIHAR" }).click();
  const detail = page.getByRole("region", { name: "Document ebihar" });
  await expect(detail.getByText("Le programme dure 18 mois.")).toBeVisible();
  await auditA11y(page, "base de connaissances");
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
  // La suppression se fait depuis le détail du document.
  await expect(page.getByRole("button", { name: "Supprimer" })).toHaveCount(0);
  await page.getByRole("button", { name: "Programme eBIHAR" }).click();
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
    page.getByText("le service de recherche n’est pas configuré", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Question du prospect").fill("une question");
  await expect(page.getByRole("button", { name: "Tester" })).toBeDisabled();
});

test("documents à recalculer : bannière et recalcul", async ({ page }) => {
  const calls = await mockApi(page, {
    docs: [doc({ needs_reindex: true, embedding_model: "ancien/modele" })],
  });
  await open(page);
  await expect(
    page.getByText("Certains documents doivent être actualisés", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Actualiser les documents" }).click();
  await expect(page.getByText("Documents actualisés.")).toBeVisible();
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
    page.getByText("1 demande nécessite une source fiable"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Traiter la demande" }),
  ).toHaveAttribute("href", "/todo?kind=kb_gap");
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

test("recherche, documents communs et remise à zéro sur mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, {
    docs: [
      doc(),
      doc({ slug: "charte", title: "Charte de référence", target_code: null }),
    ],
  });
  await open(page);
  const library = page.getByRole("region", {
    name: "Documents disponibles",
    exact: true,
  });
  await library
    .getByRole("button", { name: "Documents communs", exact: true })
    .click();
  await expect(
    library.getByRole("button", { name: "Programme eBIHAR", exact: true }),
  ).toHaveCount(0);
  await expect(
    library.getByRole("button", { name: "Charte de référence", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Rechercher un document").fill("introuvable");
  await expect(
    page.getByText("Aucun document ne correspond à ces critères.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les filtres" }).click();
  await expect(
    library.getByRole("button", { name: "Programme eBIHAR", exact: true }),
  ).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Charte de référence", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("sans service configuré, ajout bloqué et lecture préservée", async ({
  page,
}) => {
  await mockApi(page, { configured: false });
  await open(page);
  await expect(
    page.getByRole("button", { name: "Ajouter un document", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Programme eBIHAR", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Document ebihar" }),
  ).toBeVisible();
});

test("changer de programme retire les résultats de la question précédente", async ({
  page,
}) => {
  await mockApi(page);
  await open(page);
  await page
    .getByLabel("Question du prospect")
    .fill("Combien de temps dure le programme ?");
  await page.getByRole("button", { name: "Tester", exact: true }).click();
  await expect(page.getByText("0.846", { exact: true })).toBeVisible();
  await page
    .getByLabel("Programme du prospect")
    .selectOption("master_candidates");
  await expect(page.getByText("0.846", { exact: true })).toHaveCount(0);
});

test("panne du statut de recherche : lecture possible et nouvelle tentative", async ({
  page,
}) => {
  await mockApi(page);
  let ready = false;
  await page.route("**/api/v1/knowledge/status", (route) =>
    route.fulfill(
      ready
        ? {
            json: {
              configured: true,
              embedding_model: "gemini/gemini-embedding-001",
              min_score: 0.6,
              top_k: 4,
            },
          }
        : {
            status: 503,
            json: { detail: "Service de recherche indisponible" },
          },
    ),
  );
  await open(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Service de recherche indisponible" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Programme eBIHAR", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ajouter un document", exact: true }),
  ).toBeDisabled();
  ready = true;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ajouter un document", exact: true }),
  ).toBeEnabled();
});
