import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";

const report = (dry: boolean) => ({
  dry_run: dry,
  total: 3,
  created: 2,
  existing: 1,
  invalid: [{ row: 4, error: "email : adresse invalide" }],
  columns: { Prénom: "first_name", "E-mail": "email", Remarque: "(ignorée)" },
});

async function mockApi(page: Page, calls: string[]) {
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
        email: "p@example.com",
        role: "ADVISOR",
      };
    else if (path === "/prospects/import") {
      const raw = request.postData() ?? "";
      const dry = /name="dry_run"\r\n\r\ntrue/.test(raw);
      calls.push(dry ? "preview" : "import");
      if (!raw.includes('filename="salon.csv"')) calls.push("no-file");
      body = report(dry);
    } else if (path === "/campaigns")
      body = { items: [], total: 0, limit: 200, offset: 0 };
    else if (path === "/todo")
      body = { items: [], total: 0, limit: 1, offset: 0, counts: {} };
    else if (path === "/agent/mode") body = { mode: "assisted" };
    else code = 404;
    await route.fulfill({ status: code, json: body });
  });
}

test("import depuis une source : conserver la destination dans l’aperçu et l’enregistrement", async ({ page }) => {
  await mockApi(page, []);
  await page.route("**/api/v1/campaigns?**", route => route.fulfill({ json: {
    items: [{ id: 4, name: "Rentrée", sources: [{ id: 9, name: "Salon" }] }],
    total: 1, limit: 200, offset: 0,
  } }));
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("paul");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  // Attendre la fin de la connexion (jeton enregistré, redirection) avant de naviguer.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto("/prospects/import?campaign=4&source=9");
  await expect(page.getByLabel("Campagne", { exact: true })).toHaveAttribute("data-value", "4");
  await expect(page.getByLabel("Source", { exact: true })).toHaveAttribute("data-value", "9");
  await page.getByLabel("Fichier CSV (2 Mo, 5000 lignes maximum)").setInputFiles({
    name: "salon.csv", mimeType: "text/csv", buffer: Buffer.from("email\ntest@demo.example.com\n"),
  });
  for (const action of ["Aperçu", "Importer"]) {
    const request = page.waitForRequest(r => r.url().endsWith("/prospects/import") && r.method() === "POST");
    await page.getByRole("button", { name: action, exact: true }).click();
    const body = (await request).postData() ?? "";
    expect(body).toMatch(/name="campaign_id"\r\n\r\n4/);
    expect(body).toMatch(/name="source_id"\r\n\r\n9/);
  }
});

test("import CSV : aperçu obligatoire puis import", async ({ page }) => {
  const calls: string[] = [];
  await mockApi(page, calls);
  await page.goto("/login");
  await page.getByLabel("Email ou nom").fill("paul");
  await page.getByLabel("Mot de passe").fill("x");
  await page.getByRole("button", { name: "Se connecter" }).click();
  // Attendre la fin de la connexion (jeton enregistré, redirection) avant de naviguer.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto("/prospects/import");
  const importButton = page.getByRole("button", { name: "Importer" });
  await page
    .getByLabel("Fichier CSV (2 Mo, 5000 lignes maximum)")
    .setInputFiles({
      name: "salon.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Prénom;E-mail\nJean;jean@exemple.fr\n"),
    });
  await expect(importButton).toBeDisabled();
  await page.getByRole("button", { name: "Aperçu" }).click();
  const preview = page.getByRole("region", { name: "Aperçu de l’import" });
  await expect(
    preview.getByText("Ligne 4 : email : adresse invalide"),
  ).toBeVisible();
  await expect(preview.getByText("à créer")).toBeVisible();
  await importButton.click();
  await expect(
    page.getByRole("region", { name: "Résultat de l’import" }),
  ).toBeVisible();
  expect(calls).toEqual(["preview", "import"]);
  await auditA11y(page, "import CSV");
});
