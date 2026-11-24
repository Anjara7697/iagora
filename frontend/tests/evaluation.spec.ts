import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const NEW = "d".repeat(32);

const indicators = (conform: [number, number], offers: number, questions: number) => [
  {
    key: "conform",
    label: "Conversations conformes",
    group: "Conformité",
    value: conform[0] / conform[1],
    display: `${conform[0]}/${conform[1]} (${Math.round((100 * conform[0]) / conform[1])} %)`,
    better: "up",
    kind: "rate",
  },
  {
    key: "advisor_offers",
    label: "Offres de conseiller",
    group: "Technique de vente",
    value: offers,
    display: String(offers),
    better: "down",
    kind: "number",
  },
  {
    key: "repeated_questions",
    label: "Questions reposées",
    group: "Technique de vente",
    value: questions,
    display: String(questions),
    better: "down",
    kind: "number",
  },
];

const run = (over: Record<string, unknown>) => ({
  suite: "conversations",
  suite_label: "Conversations",
  notes: "",
  source: "import",
  status: "done",
  settings: {},
  model: "gemini/gemini-3.1-flash-lite",
  created_at: "2026-11-17T10:00:00Z",
  indicators: [],
  ...over,
});

const RUNS = [
  run({ id: B, label: "conv-apres-1", ran_at: "2026-11-17T11:00:00Z", indicators: indicators([8, 9], 0, 3) }),
  run({ id: A, label: "conv-avant-2", ran_at: "2026-11-16T11:00:00Z", indicators: indicators([8, 9], 5, 6) }),
  run({
    id: C,
    suite: "agent",
    suite_label: "Cas un par un",
    label: "eval-avant-2",
    ran_at: "2026-11-15T11:00:00Z",
    indicators: [{ ...indicators([45, 49], 0, 0)[0], label: "Cas conformes" }],
  }),
];

const CATALOG = {
  suites: [
    { key: "agent", label: "Cas un par un", items: [{ id: "hb_cpf", title: "CPF ?", group: "hors_base" }], categories: ["hors_base"], ablations: ["sans-rag"] },
    {
      key: "conversations",
      label: "Conversations",
      items: [
        { id: "parcours_rdv_ebihar", title: "Parcours jusqu’au rendez-vous", turns: 4, live_only: false },
        { id: "sans_redemande", title: "Sans redemande", turns: 3, live_only: false },
      ],
    },
    {
      key: "simulation",
      label: "Prospects simulés",
      items: [
        { id: "etudiant_m1_hesitant", title: "Étudiant en M1, hésitant", turns: 6 },
        { id: "presse_rendez_vous", title: "Prospect pressé", turns: 5 },
      ],
    },
    { key: "kb", label: "Base de connaissances", items: [{ id: "0", title: "Durée ?", group: "ebihar_students" }] },
  ],
  model: { available: true, name: "gemini/gemini-3.1-flash-lite" },
  embeddings: { available: true, name: "gemini/gemini-embedding-001" },
  rag_min_score: 0.6,
  llm_calls_per_turn: 2,
  simulation_calls_per_turn: 3,
  running: null,
};

const DETAIL = {
  ...RUNS[0],
  report: {
    summary: {},
    conversations: [
      {
        id: "arret_en_cours",
        title: "Désinscription en cours de route",
        ok: false,
        turns: [
          { id: "arret_en_cours#1", ok: false },
          { id: "arret_en_cours#2", ok: true },
        ],
        issues: ["arret_en_cours#1 : transfert attendu"],
        transcript: [
          { role: "prospect", text: "Les cours sont-ils en français ?" },
          { role: "agent", text: "Je préfère laisser un conseiller vous apporter cette précision." },
          { role: "prospect", text: "STOP" },
        ],
      },
    ],
  },
};

type Calls = { posts: { path: string; body: unknown }[] };

async function mockApi(page: Page, opts: { role?: string } = {}) {
  const calls: Calls = { posts: [] };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    let body: unknown = { detail: "Introuvable" };
    let code = 200;
    if (path === "/auth/login") body = { access_token: "t" };
    else if (path === "/auth/me") body = { id: 1, username: "admin", role: opts.role ?? "ADMIN", email: "a@example.com" };
    else if (path === "/todo") body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else if (path === "/evaluations" && method === "GET") body = RUNS;
    else if (path === "/evaluations/catalog") body = CATALOG;
    else if (path === "/evaluations" && method === "POST") {
      calls.posts.push({ path, body: request.postDataJSON() });
      code = 202;
      body = run({ id: NEW, label: "Mesure D-34", ran_at: "2026-11-17T12:00:00Z", status: "running", source: "app" });
    } else if (path === "/evaluations/import") {
      calls.posts.push({ path, body: request.postDataJSON() });
      code = 201;
      body = RUNS[1];
    } else if (path === `/evaluations/${B}`) body = DETAIL;
    else if (path === `/evaluations/${NEW}`)
      body = run({ id: NEW, label: "Mesure D-34", ran_at: "2026-11-17T12:00:00Z", status: "running", progress: { done: 1, total: 2, ok: 1 } });
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
  return calls;
}

async function open(page: Page, path = "/evaluation") {
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("admin");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto(path);
}

test("historique, comparaison avant/après et évolution d’un indicateur", async ({ page }) => {
  await mockApi(page);
  await open(page);
  await expect(page.getByRole("heading", { level: 1, name: "Évaluation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Évaluation" })).toBeVisible(); // entrée du menu
  await expect(page.getByRole("row", { name: /conv-apres-1/ })).toBeVisible();
  await expect(page.getByText("3 passages")).toBeVisible();
  await auditA11y(page, "évaluation : historique");

  await page.getByRole("tab", { name: "Comparer" }).click();
  await expect(page).toHaveURL(/tab=compare/);
  // Par défaut : l'avant-dernier (avant) et le dernier (après) passage de la suite.
  await expect(page.getByText("2 indicateurs en progrès, 0 en recul, 1 inchangé.")).toBeVisible();
  const offers = page.getByRole("row", { name: /Offres de conseiller/ });
  await expect(offers).toContainText("−5 · en progrès");
  await auditA11y(page, "évaluation : comparaison");

  await page.getByRole("tab", { name: "Évolution" }).click();
  await expect(page.getByRole("group", { name: /Conversations conformes : évolution sur 2 passages/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /conv-avant-2/ })).toContainText("8/9");
  await auditA11y(page, "évaluation : évolution");
});

test("lancer avec le vrai modèle demande une confirmation qui annonce les appels", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page, "/evaluation?tab=launch");
  await page.getByLabel("Nom du passage").fill("Mesure D-34");
  await page.getByRole("tab", { name: /Vrai modèle/ }).click();
  await page.getByRole("button", { name: "Lancer l’évaluation" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("2 éléments, environ 14 appels à gemini/gemini-3.1-flash-lite");
  await dialog.getByRole("button", { name: "Lancer" }).click();
  await expect(page).toHaveURL(new RegExp(`/evaluation/${NEW}$`));
  expect(calls.posts[0].body).toMatchObject({ suite: "conversations", label: "Mesure D-34", live: true, pause: 4, ids: [], cleanup: true });
  await expect(page.getByText("1 sur 2 joués, 1 conformes.")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Avancement du passage" })).toHaveAttribute("aria-valuetext", /^50\s%$/);
  await expect(page.getByRole("button", { name: "Annuler le passage" })).toBeVisible();
});

test("prospects simulés : passages par profil et appels annoncés (un de plus par message)", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page, "/evaluation?tab=launch");
  await page.getByRole("tab", { name: "Prospects simulés" }).click();
  await page.getByLabel("Nom du passage").fill("Simulation D-44");
  await page.getByLabel("Passages par profil").fill("2");
  await page.getByRole("tab", { name: /Vrai modèle/ }).click();
  await page.getByRole("button", { name: "Lancer l’évaluation" }).click();
  // (6 + 5) messages au plus × 2 passages × 3 appels (le prospect simulé en ajoute un).
  await expect(page.getByRole("alertdialog")).toContainText("2 éléments, environ 66 appels");
  await page.getByRole("alertdialog").getByRole("button", { name: "Lancer" }).click();
  expect(calls.posts[0].body).toMatchObject({ suite: "simulation", label: "Simulation D-44", live: true, passes: 2, ids: [] });
});

test("détail d’un passage : indicateurs, puis l’échange complet d’une conversation", async ({ page }) => {
  await mockApi(page);
  await open(page, `/evaluation/${B}`);
  await expect(page.getByRole("heading", { level: 1, name: /conv-apres-1/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Questions reposées/ })).toContainText("3");
  await expect(page.getByRole("link", { name: "Comparer au précédent" })).toHaveAttribute("href", new RegExp(`a=${A}&b=${B}`));
  await page.getByRole("tab", { name: "Détail" }).click();
  await page.getByRole("row", { name: /Désinscription en cours de route/ }).click();
  const panel = page.getByRole("dialog", { name: "Désinscription en cours de route" });
  await expect(panel.getByText("Je préfère laisser un conseiller vous apporter cette précision.")).toBeVisible();
  await expect(panel.getByText("arret_en_cours#1 : transfert attendu")).toBeVisible();
  await expect(page).toHaveURL(/tab=details&item=arret_en_cours/);
  await auditA11y(page, "évaluation : échange d’une conversation");
});

test("importer un rapport de la ligne de commande", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  await page.getByRole("button", { name: "Importer un rapport" }).first().click();
  const panel = page.getByRole("dialog", { name: "Importer un rapport" });
  const report = { meta: { model: "gemini/x" }, summary: { conform: { ok: 8, total: 9 } }, conversations: [{ id: "x", ok: true, turns: [] }] };
  await panel.locator('input[type="file"]').setInputFiles({ name: "conv-apres-2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report)) });
  await expect(panel.getByText("Reconnu : Conversations, 1 élément.")).toBeVisible();
  await expect(panel.getByLabel("Nom du passage")).toHaveValue("conv-apres-2");
  await panel.getByRole("button", { name: "Importer" }).click();
  await expect(page.getByText("Rapport importé")).toBeVisible();
  expect(calls.posts[0]).toMatchObject({ path: "/evaluations/import", body: { label: "conv-apres-2", file_name: "conv-apres-2.json", report } });
});

test("réservée aux administrateurs", async ({ page }) => {
  await mockApi(page, { role: "ADVISOR" });
  await open(page);
  await expect(page.getByText("L’évaluation de l’agent est réservée aux administrateurs.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Évaluation" })).toHaveCount(0);
});

test("normalisation : un seul bouton primaire, titres hiérarchisés, audit strict sur chaque écran", async ({ page }) => {
  await mockApi(page);
  const primaries = () => page.getByRole("main").locator(".button--primary").filter({ visible: true });
  await open(page);
  for (const [tab, name] of [["history", "Historique"], ["launch", "Lancer"], ["compare", "Comparer"], ["evolution", "Évolution"]] as const) {
    await page.goto(tab === "history" ? "/evaluation" : `/evaluation?tab=${tab}`);
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.waitForLoadState("networkidle");
    // Une seule action principale par écran ; dans Lancer, c'est le bouton du formulaire.
    await expect(primaries()).toHaveCount(1);
    if (tab === "launch") await expect(primaries()).toHaveText("Lancer l’évaluation");
    await auditA11y(page, `évaluation : ${name}`, [], { strict: true });
  }
  // Évolution : tableau de la console, la ligne ouvre le passage.
  await page.getByRole("row", { name: /conv-avant-2/ }).click();
  await expect(page).toHaveURL(new RegExp(`/evaluation/${A}$`));
  // Détail d'un passage (servi par l'API simulée pour B) : titre, indicateurs en h2, audit strict.
  await page.goto(`/evaluation/${B}`);
  await expect(page.getByRole("heading", { level: 1, name: /conv-apres-1/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await auditA11y(page, "évaluation : passage", [], { strict: true });
  // Passage introuvable : titre de page, retour à l'historique.
  await page.goto(`/evaluation/${"e".repeat(32)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Passage introuvable" })).toBeVisible();
  await auditA11y(page, "évaluation : passage introuvable", [], { strict: true });
});
