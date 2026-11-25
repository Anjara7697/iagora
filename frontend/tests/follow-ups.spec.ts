import { expect, test, type Page } from "@playwright/test";
import { auditA11y } from "./a11y";
import { mockConsole, NOW } from "./fixtures/console";

/** Relances prévues : la prochaine sur la fiche prospect et la conversation, avec Décaler et Annuler. */

test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

type Planned = {
  id: number;
  prospect_id: number;
  prospect_name: string;
  channel: string | null;
  scheduled_at: string;
  expected_at: string;
  reason: string | null;
};

const planned = (over: Partial<Planned> = {}): Planned => ({
  id: 7,
  prospect_id: 1,
  prospect_name: "Marie Dupont",
  channel: "email",
  // Lundi 16 novembre, 10 h à Paris.
  scheduled_at: "2026-11-16T09:00:00Z",
  expected_at: "2026-11-16T09:00:00Z",
  reason: "Entretien d'un prospect peu engagé",
  ...over,
});

/** API simulée de la console, plus les relances du prospect 1 (état gardé entre les requêtes). */
async function mockFollowUps(page: Page, items: Planned[], role = "ADMIN") {
  const calls: { path: string; body: unknown }[] = [];
  await page.clock.setFixedTime(NOW);
  await mockConsole(page);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, "");
    if (path === "/auth/me")
      return route.fulfill({ json: { id: 1, username: "nadia.cisse", role, email: "nadia.cisse@example.com" } });
    if (path === "/prospects/1/follow-ups") return route.fulfill({ json: items });
    const cancel = path.match(/^\/follow-ups\/(\d+)\/cancel$/);
    if (cancel && request.method() === "POST") {
      calls.push({ path, body: null });
      items.splice(items.findIndex((f) => f.id === Number(cancel[1])), 1);
      return route.fulfill({ status: 204 });
    }
    const move = path.match(/^\/follow-ups\/(\d+)\/reschedule$/);
    if (move && request.method() === "POST") {
      const body = request.postDataJSON() as { scheduled_at: string };
      calls.push({ path, body });
      const f = items.find((x) => x.id === Number(move[1]))!;
      f.scheduled_at = f.expected_at = body.scheduled_at;
      return route.fulfill({ json: f });
    }
    return route.fallback();
  });
  return calls;
}

test("fiche prospect : prochaine relance, puis annulation confirmée", { tag: ["@mobile"] }, async ({ page }) => {
  const calls = await mockFollowUps(page, [planned(), planned({ id: 8, scheduled_at: "2026-11-23T09:00:00Z", expected_at: "2026-11-23T09:00:00Z" })]);
  await page.goto("/prospects/1");
  const card = page.getByRole("region", { name: "Prochaine relance" });
  await expect(card.getByText("Prochaine relance : lundi 16 novembre à 10 h")).toBeVisible();
  await expect(card.getByText("Entretien d'un prospect peu engagé · Email")).toBeVisible();
  await expect(card.getByText(/1 autre relance prévue ensuite/)).toBeVisible();
  await auditA11y(page, "relance-fiche");

  await card.getByRole("button", { name: "Annuler la relance de Marie Dupont" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Annuler cette relance ?" });
  await expect(dialog.getByText(/il pourra en programmer une autre/)).toBeVisible();
  await dialog.getByRole("button", { name: "Annuler la relance" }).click();
  await expect(page.getByText("Relance annulée")).toBeVisible();
  expect(calls).toEqual([{ path: "/follow-ups/7/cancel", body: null }]);
  // La suivante devient la prochaine.
  await expect(card.getByText("Prochaine relance : lundi 23 novembre à 10 h")).toBeVisible();
});

test("fiche prospect : décaler de 3 jours, ou à une date choisie", async ({ page }) => {
  const calls = await mockFollowUps(page, [planned()]);
  await page.goto("/prospects/1");
  const card = page.getByRole("region", { name: "Prochaine relance" });
  await card.getByRole("button", { name: "Décaler la relance de Marie Dupont" }).click();
  await page.getByRole("menuitem", { name: "De 3 jours" }).click();
  await expect(card.getByText("Prochaine relance : jeudi 19 novembre à 10 h")).toBeVisible();
  expect(calls.at(-1)).toEqual({
    path: "/follow-ups/7/reschedule",
    body: { scheduled_at: "2026-11-19T09:00:00.000Z" },
  });

  await card.getByRole("button", { name: "Décaler la relance de Marie Dupont" }).click();
  await page.getByRole("menuitem", { name: "Choisir la date et l’heure…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Décaler la relance" });
  const field = dialog.getByLabel("Nouvelle date et heure");
  await field.fill("2026-11-10T10:00"); // déjà passé
  await expect(dialog.getByText("Choisissez une heure à venir.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Décaler", exact: true })).toBeDisabled();
  await field.fill("2026-11-25T14:30");
  await dialog.getByRole("button", { name: "Décaler", exact: true }).click();
  await expect(card.getByText("Prochaine relance : mercredi 25 novembre à 14 h 30")).toBeVisible();
  expect(calls.at(-1)?.body).toEqual({ scheduled_at: "2026-11-25T13:30:00.000Z" });
});

test("relance hors des heures d'envoi : l'heure de départ réelle est montrée", async ({ page }) => {
  // Programmée samedi 14 à 3 h, elle part lundi 16 à 8 h.
  await mockFollowUps(page, [planned({ scheduled_at: "2026-11-14T02:00:00Z", expected_at: "2026-11-16T07:00:00Z" })]);
  await page.goto("/prospects/1");
  const card = page.getByRole("region", { name: "Prochaine relance" });
  await expect(card.getByText("Prochaine relance : lundi 16 novembre à 8 h")).toBeVisible();
  await expect(card.getByText("Programmée demain à 3 h, hors des heures d’envoi : elle partira à leur ouverture.")).toBeVisible();
});

test("conversation : la prochaine relance est affichée au-dessus du contexte", async ({ page }) => {
  await mockFollowUps(page, [planned()]);
  await page.goto("/conversations?id=c1");
  const card = page.getByRole("region", { name: "Prochaine relance" });
  await expect(card.getByText("Prochaine relance : lundi 16 novembre à 10 h")).toBeVisible();
  await expect(card.getByRole("button", { name: /Décaler/ })).toBeVisible();
});

test("observateur : la relance est visible, sans action", async ({ page }) => {
  await mockFollowUps(page, [planned()], "VIEWER");
  await page.goto("/prospects/1");
  const card = page.getByRole("region", { name: "Prochaine relance" });
  await expect(card.getByText("Prochaine relance : lundi 16 novembre à 10 h")).toBeVisible();
  await expect(card.getByRole("button")).toHaveCount(0);
});

test("aucune relance prévue : pas de carte", async ({ page }) => {
  await mockFollowUps(page, []);
  await page.goto("/prospects/1");
  await expect(page.getByRole("heading", { name: "Marie Dupont", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: "Prochaine relance" })).toHaveCount(0);
});
