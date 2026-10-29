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

test("candidature directe : le conseiller voit la demande et ses indices", async ({ page }) => {
  await mockApi(page);
  let stage = "new";
  let resolved = false;
  const application = {
    ...gapItem,
    id: "handoff:application",
    kind: "application",
    title: "Candidature à vérifier",
    detail: "J'ai envoyé mon dossier de candidature.",
    prospect: { ...prospect, id: 42, first_name: "Sam", last_name: "Test", email: "sam@demo.example.com" },
    handoff: {
      reason: "candidature_a_verifier",
      summary: "Document : dossier.pdf. Campagne suggérée : eBIHAR. Vérifier le document original.",
      pending_question: "J'ai envoyé mon dossier de candidature.",
      recommended_action: "Vérifier le dossier et confirmer la candidature",
    },
    recommendation: {
      action: "Vérifier le dossier et confirmer la candidature",
      reason: "Document : dossier.pdf. Campagne suggérée : eBIHAR.",
      risk: "medium", confidence: null, sources: [],
    },
  };
  await page.route("**/api/v1/todo?**", route => route.fulfill({ json: {
    items: resolved ? [] : [application], total: resolved ? 0 : 1,
    limit: 50, offset: 0, counts: { application: resolved ? 0 : 1 },
  } }));
  await page.route("**/api/v1/prospects/42", route => route.fulfill({ json: {
    id: 42, campaigns: [{ id: 17, campaign_name: "eBIHAR", source_name: "Email", conversion_stage: stage }],
  } }));
  await page.route("**/api/v1/conversations/c2/resolve-application", async route => {
    expect(route.request().postDataJSON()).toEqual({ membership_id: 17 });
    resolved = true;
    await route.fulfill({ json: { status: "open", handoff: null } });
  });
  await open(page);
  await expect(page.getByRole("button", { name: "Candidatures (1)" })).toBeVisible();
  await page.getByRole("complementary", { name: "Éléments à traiter" })
    .getByRole("button", { name: /Sam Test/ }).click();
  await expect(page.getByText("Campagne suggérée : eBIHAR.").first()).toBeVisible();
  await expect(page.getByText("Vérifier le document original.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Ouvrir la fiche/ })).toHaveAttribute("href", /\/prospects\/42/);
  // Le parcours n'est pas encore à « Candidature déposée » : on le change d'ici.
  let stagePatch: unknown = null;
  await page.route("**/api/v1/campaign-prospects/17", async (route) => {
    stagePatch = route.request().postDataJSON();
    stage = "applied";
    await route.fulfill({ json: { id: 17, conversion_stage: "applied" } });
  });
  const finish = page.getByRole("button", {
    name: "Passer à « Candidature déposée » et terminer",
  });
  await expect(page.getByLabel("Parcours concerné")).toHaveValue("17");
  await expect(finish).toBeDisabled();
  await page.getByLabel("J’ai contrôlé le dossier original dans la boîte email").check();
  await finish.click();
  await expect(page.getByRole("status", { name: "Résultat de la décision" })).toContainText(
    "Candidature déposée",
  );
  expect(stagePatch).toMatchObject({ conversion_stage: "applied" });
  expect(resolved).toBe(true);
});

test("email d'admission : le conseiller confirme le bon parcours avec la preuve", async ({
  page,
}) => {
  await mockApi(page);
  const enrollment = {
    ...gapItem,
    id: "handoff:enrollment",
    kind: "enrollment",
    conversation_id: "c3",
    title: "Inscription à confirmer",
    detail: "Admission confirmée",
    prospect: {
      ...prospect,
      id: 52,
      first_name: "Lina",
      email: "lina@demo.example.com",
    },
    handoff: {
      reason: "inscription_a_verifier",
      summary: "Confirmation reçue du service admissions. Vérifier l'email original.",
      pending_question: "Admission confirmée",
      recommended_action: "Vérifier la preuve et confirmer l'inscription",
      evidence_reference: "email de admissions@school.example.com reçu le 28/10/2026",
    },
    recommendation: {
      action: "Vérifier la preuve et confirmer l'inscription",
      reason: "Une confirmation positive a été repérée.",
      risk: "medium",
      confidence: null,
      sources: [],
    },
  };
  await page.route("**/api/v1/todo?**", (route) =>
    route.fulfill({
      json: {
        items: [enrollment],
        total: 1,
        limit: 50,
        offset: 0,
        counts: { enrollment: 1 },
      },
    }),
  );
  await page.route("**/api/v1/prospects/52", (route) =>
    route.fulfill({
      json: {
        id: 52,
        campaigns: [
          {
            id: 27,
            campaign_name: "eBIHAR",
            source_name: "Dossier email",
            conversion_stage: "applied",
          },
        ],
      },
    }),
  );
  let submitted: Record<string, unknown> | null = null;
  await page.route(
    "**/api/v1/conversations/c3/confirm-enrollment-email",
    async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { status: "open", handoff: null } });
    },
  );

  await open(page);
  await expect(page.getByRole("button", { name: "Inscriptions (1)" })).toBeVisible();
  await page
    .getByRole("complementary", { name: "Éléments à traiter" })
    .getByRole("button", { name: /Lina Dupont/ })
    .click();
  await page.getByLabel("Parcours confirmé par la preuve").selectOption("27");
  await page.getByLabel("Note facultative").fill("Identité vérifiée");
  await page
    .getByRole("button", { name: "Confirmer l'inscription", exact: true })
    .click();
  await expect(page.getByRole("status", { name: "Résultat de la décision" })).toContainText(
    "Inscription confirmée",
  );
  expect(submitted).toEqual({
    membership_id: 27,
    evidence_reference: "email de admissions@school.example.com reçu le 28/10/2026",
    note: "Identité vérifiée",
  });
});

test("pagination et lien direct vers une tâche hors de la page courante", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/v1/todo?**", (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    return route.fulfill({
      json: {
        items: offset ? [gapItem] : [draftItem],
        total: 51,
        limit: 50,
        offset,
        counts: { validation: 50, kb_gap: 1 },
      },
    });
  });
  await page.route("**/api/v1/todo/item?**", (route) =>
    route.fulfill({
      json: { ...gapItem, id: "handoff:old", conversation_id: "old" },
    }),
  );
  await open(page);
  await page.getByRole("button", { name: "Éléments suivants" }).click();
  await expect(
    page.getByRole("button", { name: /Ahmed Belkacem/ }),
  ).toBeVisible();
  await page.goto("/todo?id=handoff%3Aold");
  await expect(
    page.getByText("Question sans extrait validé.").first(),
  ).toBeVisible();
});

type Calls = { posts: { path: string; method: string; body: unknown }[] };

async function mockApi(
  page: Page,
  opts: { role?: string; mode?: string } = {},
) {
  const calls: Calls = { posts: [] };
  let items = [draftItem, gapItem];
  const decisions: unknown[] = [];
  let mode = opts.mode ?? "assisted";
  await page.context().route("**/api/v1/**", async (route) => {
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
    } else if (path === "/todo/treated")
      body = { items: decisions, total: decisions.length, hours: 24 };
    else if (path === "/agent/mode" && request.method() === "GET")
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
      if (action === "approve" || action === "reject") {
        items = items.filter((i) => i.id !== draftItem.id);
        const payload = request.postDataJSON() as { content?: string; reason?: string };
        decisions.push({
          id: draftItem.id, conversation_id: "c1", prospect, channel: "email",
          decision: action === "approve" ? "approved" : "rejected",
          decided_at: new Date().toISOString(), decided_by: 7,
          edited: !!payload.content, content: payload.content ?? draftItem.draft.content,
          reason: payload.reason ?? null,
          execution: action === "approve" ? "approved" : "rejected",
          execution_detail: null,
        });
      }
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

test("mobile : traitement lisible et retour explicite à la file", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockApi(page);
  await open(page);
  const list = page.getByRole("complementary", { name: "Éléments à traiter" });
  await list.getByRole("button", { name: /Marie Dupont/ }).click();
  await expect(
    page.getByRole("region", { name: "Brouillon de l'agent" }),
  ).toBeVisible();
  await expect(list).toBeHidden();
  // The response is readable immediately, before scrolling through diagnostics.
  await expect(page.getByText("Bonjour Marie, le financement est possible.")).toBeInViewport();
  const approve = page.getByRole("button", { name: "Valider la réponse", exact: true });
  await approve.scrollIntoViewIfNeeded();
  await expect(approve).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "← Liste des éléments", exact: true })
    .click();
  await expect(list).toBeVisible();
  expect(calls.posts).toHaveLength(0);
});

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

  await page.getByRole("button", { name: "Réponses à compléter (1)" }).click();
  await expect(list.getByText("Marie Dupont")).toHaveCount(0);
  await page.getByRole("button", { name: /^Tout/ }).click();

  await list.getByRole("button", { name: /Marie Dupont/ }).click();
  const detail = page.getByRole("region", { name: "À traiter : Marie Dupont" });
  await expect(detail.getByText("Prochaine action recommandée")).toBeVisible();
  const evidence = detail.getByRole("region", { name: "Éléments pour décider" });
  const draft = detail.getByRole("region", { name: "Brouillon de l'agent" });
  expect(
    await evidence.evaluate((el) =>
      Boolean(el.compareDocumentPosition(el.parentElement!.querySelector(".draft-panel")!) & Node.DOCUMENT_POSITION_FOLLOWING),
    ),
  ).toBe(true);
  await expect(draft.getByRole("button", { name: "Valider la réponse", exact: true })).toBeEnabled();
  await expect(detail.getByText("Risque : faible", { exact: true })).toBeVisible();
  await expect(detail.getByLabel("Confiance 91 %")).toBeHidden();
  const sources = detail.getByText("Sources, confiance et contexte", { exact: true });
  await sources.focus();
  await page.keyboard.press("Enter");
  await expect(detail.getByText("Financement & OPCO v3").first()).toBeVisible();
  await expect(detail.getByLabel("Confiance 91 %")).toBeVisible();
  await expect(
    detail.getByText("Bonjour Marie, le financement est possible."),
  ).toBeVisible();
});

test("mobile : risque élevé et absence de sources visibles sans déplier les détails", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockApi(page);
  await page.route("**/api/v1/todo?**", route => route.fulfill({ json: {
    items: [{ ...draftItem, recommendation: {
      ...draftItem.recommendation, risk: "high", sources: [], confidence: null,
    } }], total: 1, limit: 50, offset: 0, counts: { validation: 1 },
  } }));
  await open(page);
  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  const detail = page.getByRole("region", { name: "À traiter : Marie Dupont" });
  await expect(detail.getByText("Risque : élevé", { exact: true })).toBeVisible();
  await expect(detail.getByText("Aucune source de la base de connaissances.")).toBeVisible();
  await expect(detail.getByText("Non évaluée", { exact: true })).toBeHidden();
  await detail.getByText("Sources, confiance et contexte", { exact: true }).click();
  await expect(detail.getByText("Non évaluée", { exact: true })).toBeVisible();
  expect(calls.posts).toHaveLength(0);
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
    .getByRole("button", { name: "Valider la version modifiée" })
    .click();
  await expect(page.getByText("Nouveau")).toHaveCount(0);
  await expect
    .poll(() => calls.posts)
    .toContainEqual({
      path: "/conversations/c1/drafts/m1/approve",
      method: "POST",
      body: { content: "Bonjour Marie, version relue." },
    });
  await expect(page.getByRole("button", { name: /Marie Dupont/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("status", { name: "Résultat de la décision" }),
  ).toContainText("Message validé");
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByLabel("1 en attente")).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "1 à traiter" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Brouillon de l'agent" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Consulter la décision →" }).click();
  await expect(page).toHaveURL(/tab=treated&id=draft%3Ac1%3Am1/);
  await expect(page.getByRole("group", { name: "Type", exact: true })).toBeHidden();
  const delivery = page.getByRole("region", { name: "État d’envoi" });
  await expect(delivery).toContainText("aucun envoi n’est encore confirmé");
  await expect(page.getByRole("region", { name: "Message traité" })).toContainText("Bonjour Marie, version relue.");
  expect(calls.posts).toHaveLength(1);
  await page.getByRole("button", { name: "À traiter", exact: true }).click();
  await page.getByRole("button", { name: "Examiner la première demande →" }).click();
  await expect(
    page.getByRole("region", { name: "À traiter : Ahmed Belkacem" }),
  ).toBeVisible();
});

test("refuser exige un motif ; régénérer appelle l'agent", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  await page.getByRole("button", { name: "Régénérer" }).click();
  await expect
    .poll(() => calls.posts.some((p) => p.path.endsWith("/regenerate")))
    .toBe(true);
  await expect(page.getByRole("link", { name: "Consulter la décision →" })).toHaveCount(0);

  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  await page.getByRole("button", { name: "Refuser le brouillon" }).click();
  const confirm = page.getByRole("button", { name: "Confirmer le refus" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Motif du refus").fill("Ton trop familier");
  await confirm.click();
  await expect
    .poll(() => calls.posts)
    .toContainEqual({
      path: "/conversations/c1/drafts/m1/reject",
      method: "POST",
      body: { reason: "Ton trop familier" },
    });
  await page.getByRole("link", { name: "Consulter la décision →" }).click();
  const delivery = page.getByRole("region", { name: "État d’envoi" });
  await expect(delivery).toContainText("aucun envoi n’a été demandé");
  await expect(delivery).toContainText("Motif du refus : Ton trop familier");
  await expect(delivery.getByRole("button", { name: "Réessayer l’envoi" })).toHaveCount(0);
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
  await expect(
    page.getByRole("button", { name: "Valider la réponse", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Arrêt d'urgence/ }),
  ).toHaveCount(0);
});

test("arrêt d'urgence et reprise du mode assisté", async ({ page }) => {
  const calls = await mockApi(page);
  await open(page);
  await expect(page.getByText("Agent — Validation requise")).toBeVisible();
  let asked = "";
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await page.getByRole("button", { name: /Arrêt d'urgence/ }).click();
  await expect(page.getByText("Agent — Arrêt d'urgence")).toBeVisible();
  expect(asked).toContain("y compris les messages déjà validés");
  await expect
    .poll(() => calls.posts)
    .toContainEqual({
      path: "/agent/mode",
      method: "PUT",
      body: { mode: "manual" },
    });
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Reprendre en mode assisté" }).click();
  await expect(page.getByText("Agent — Arrêt d'urgence")).toBeVisible();
  expect(calls.posts).toHaveLength(1);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("messages déjà validés");
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Reprendre en mode assisté" }).click();
  await expect(page.getByText("Agent — Validation requise")).toBeVisible();
});

test("l'arrêt d'urgence est également disponible en mode automatique", async ({
  page,
}) => {
  const calls = await mockApi(page, { role: "ADMIN", mode: "auto" });
  await open(page);
  await expect(page.getByText("Agent — Mode automatique")).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /Arrêt d'urgence/ }).click();
  await expect(page.getByText("Agent — Arrêt d'urgence")).toBeVisible();
  await expect
    .poll(() => calls.posts)
    .toContainEqual({
      path: "/agent/mode",
      method: "PUT",
      body: { mode: "manual" },
    });
});

test("brouillon : objet, pied de message non modifiable et exécution à valider", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/v1/todo?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("limit") === "50")
      await route.fulfill({
        json: {
          items: [
            {
              ...draftItem,
              draft: {
                ...draftItem.draft,
                subject: "Re: Financement du Master",
                footer: "Répondez STOP pour ne plus recevoir de messages.",
              },
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
          counts: { validation: 1 },
        },
      });
    else await route.fallback();
  });
  await open(page);
  await page
    .getByRole("button", { name: /Marie Dupont/ })
    .first()
    .click();
  const draft = page.getByRole("region", { name: "Brouillon de l'agent" });
  await expect(
    draft.getByText("objet : Re: Financement du Master"),
  ).toBeVisible();
  await expect(
    draft.getByText("ajouté automatiquement, non modifiable"),
  ).toBeVisible();
  await expect(
    draft.getByText("Répondez STOP pour ne plus recevoir de messages."),
  ).toBeVisible();
  await expect(draft.getByText("pied de message compris")).toBeVisible();
  await page.getByText("Sources, confiance et contexte", { exact: true }).click();
  await expect(page.getByText("À valider", { exact: true })).toBeVisible();
});

test("traités : trace de la décision, état d'envoi et nouvelle tentative", async ({
  page,
}) => {
  await mockApi(page);
  const retries: string[] = [];
  let execution = "failed";
  await page.route("**/api/v1/todo/treated", async (route) =>
    route.fulfill({
      json: {
        hours: 24,
        total: 2,
        items: [
          {
            id: "draft:c9:m9",
            conversation_id: "c9",
            prospect: { ...prospect, first_name: "Karim", last_name: "Sylla" },
            channel: "email",
            decision: "approved",
            decided_at: "2026-10-15T09:00:00Z",
            decided_by: 1,
            edited: true,
            content: "Bonjour Karim, voici les informations.",
            reason: null,
            execution,
            execution_detail: execution === "failed" ? "SMTP : envoi refusé" : null,
          },
          {
            id: "draft:c8:m8",
            conversation_id: "c8",
            prospect: { ...prospect, first_name: "Léa", last_name: "Fontaine" },
            channel: "email",
            decision: "rejected",
            decided_at: "2026-10-15T08:00:00Z",
            decided_by: 1,
            edited: false,
            content: "Brouillon refusé.",
            reason: "Ton trop familier",
            execution: "rejected",
            execution_detail: null,
          },
        ],
      },
    }),
  );
  await page.route(
    "**/api/v1/conversations/c9/messages/m9/retry-delivery",
    async (route) => {
      retries.push(route.request().url());
      execution = "sending";
      await route.fulfill({
        json: { id: "m9", metadata: { delivery: "not_sent" } },
      });
    },
  );
  await open(page);
  await page.getByRole("button", { name: "Traités (24 h) (2)" }).click();
  await page.getByRole("button", { name: /Karim Sylla/ }).click();
  const detail = page.getByRole("region", { name: "Traité : Karim Sylla" });
  await expect(detail.getByText("Échec d’envoi")).toBeVisible();
  await expect(detail.getByText("SMTP : envoi refusé")).toBeVisible();
  await expect(detail.getByText("Validé (modifié)")).toBeVisible();
  await detail.getByRole("button", { name: "Réessayer l’envoi" }).click();
  await expect.poll(() => retries.length).toBe(1);
  await expect(detail.getByRole("status")).toContainText("Nouvelle tentative demandée");
  await expect(detail.getByRole("heading", { name: "Envoi en cours" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Réessayer l’envoi" })).toHaveCount(0);
  execution = "sent";
  await detail.getByRole("button", { name: "Actualiser l’état" }).click();
  await expect(detail.getByRole("heading", { name: "Envoyée", exact: true })).toBeVisible();
  expect(retries).toHaveLength(1);
  await page.getByRole("button", { name: /Léa Fontaine/ }).click();
  await expect(
    page.getByText("Motif du refus : Ton trop familier"),
  ).toBeVisible();
});

test("échec de validation : le brouillon reste accessible et aucune réussite n’est annoncée", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/v1/conversations/c1/drafts/m1/approve", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Validation temporairement indisponible" },
    }),
  );
  await open(page);
  await page
    .getByRole("button", { name: "Examiner la première demande →" })
    .click();
  await page
    .getByRole("button", { name: "Valider la réponse", exact: true })
    .click();
  const draft = page.getByRole("region", { name: "Brouillon de l'agent" });
  await expect(draft.getByRole("alert")).toHaveText(
    "Validation temporairement indisponible",
  );
  await expect(
    draft.getByRole("button", { name: "Valider la réponse", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Message validé.", { exact: false })).toHaveCount(
    0,
  );
});

for (const role of ["ADVISOR", "VIEWER"]) {
  test(`fiche depuis une demande : retour au filtre et consultation sans perte (${role})`, async ({ page }) => {
    if (role === "VIEWER") await page.setViewportSize({ width: 390, height: 844 });
    const calls = await mockApi(page, { role });
    await page.context().route("**/api/v1/prospects/1", (route) => route.fulfill({ json: {
      ...prospect, phone: null, profile: {}, campaigns: [], consent_status: "granted",
      consent_source: "formulaire", created_at: draftItem.created_at,
    }}));
    await page.context().route("**/api/v1/prospects/1/conversation", (route) => route.fulfill({ json: {
      id: "c1", status: "open", channel: "email", messages: [], handoff: null,
    }}));
    await page.context().route("**/api/v1/prospects/1/agent-runs", (route) => route.fulfill({ json: [] }));
    await page.context().route("**/api/v1/campaigns?**", (route) => route.fulfill({ json: {items: [], total: 0} }));
    await open(page);
    await page.getByRole("button", { name: "Brouillons à valider (1)" }).click();
    await expect(page).toHaveURL(/kind=validation/);
    await page.getByRole("button", { name: /Marie Dupont/ }).click();
    if (role === "ADVISOR") {
      await page.getByRole("button", { name: "Modifier", exact: true }).click();
      await page.getByLabel("Texte du brouillon").fill("Version en cours de relecture.");
    }
    const [profile] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "Ouvrir la fiche prospect dans un nouvel onglet" }).click(),
    ]);
    await profile.setViewportSize(page.viewportSize()!);
    await expect(profile.getByRole("heading", { name: "Marie Dupont", exact: true })).toBeVisible();
    await profile.reload();
    await profile.getByRole("link", { name: "← Revenir à la demande" }).click();
    await expect(profile).toHaveURL(/\/todo\?id=draft%3Ac1%3Am1&kind=validation$/);
    await expect(profile.getByRole("region", { name: "À traiter : Marie Dupont" })).toBeVisible();
    if (role === "ADVISOR") await expect(profile.getByRole("button", { name: "Brouillons à valider (1)" })).toHaveAttribute("aria-pressed", "true");
    if (role === "VIEWER") await expect(profile.getByRole("button", { name: "Valider la réponse", exact: true })).toHaveCount(0);
    await profile.close();
    if (role === "ADVISOR") await expect(page.getByLabel("Texte du brouillon")).toHaveValue("Version en cours de relecture.");
    expect(calls.posts).toHaveLength(0);
  });
}

const blockedDecision = {
  id: draftItem.id,
  conversation_id: "c1",
  prospect,
  channel: "email",
  decision: "approved",
  decided_at: new Date().toISOString(),
  decided_by: 7,
  edited: false,
  content: draftItem.draft.content,
  reason: null,
  execution: "blocked",
  execution_detail: "La messagerie est désactivée.",
};

test("mobile : la confirmation est visible et mène à la décision exacte", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockApi(page);
  await open(page);
  await page.getByRole("button", { name: /Marie Dupont/ }).click();
  await page.getByRole("button", { name: "Valider la réponse", exact: true }).click();
  const result = page.getByRole("status", { name: "Résultat de la décision" });
  await expect(result).toContainText("Marie Dupont");
  await expect(result).toBeInViewport({ ratio: 1 });
  await expect(result).toBeFocused();
  await result.getByRole("link", { name: "Consulter la décision →" }).click();
  await expect(page.getByRole("region", { name: "Traité : Marie Dupont" })).toBeVisible();
  await expect(page.getByRole("region", { name: "État d’envoi" })).toContainText("aucun envoi n’est encore confirmé");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls.posts).toHaveLength(1);
});

test("décision directe : erreur récupérable et absence dans la fenêtre de 24 heures", async ({ page }) => {
  const calls = await mockApi(page);
  let state: "error" | "missing" | "ready" = "error";
  await page.route("**/api/v1/todo/treated", (route) => state === "error"
    ? route.fulfill({ status: 503, json: { detail: "Historique temporairement indisponible" } })
    : route.fulfill({ json: { hours: 24, total: state === "ready" ? 1 : 0, items: state === "ready" ? [blockedDecision] : [] } }));
  await open(page);
  await page.goto("/todo?tab=treated&id=draft%3Ac1%3Am1");
  const detail = page.getByRole("region", { name: "Décision recherchée" });
  await expect(detail.getByRole("alert")).toContainText("Historique temporairement indisponible");
  await expect(detail.getByText("Cette décision n’est pas dans la liste.")).toHaveCount(0);
  state = "missing";
  await detail.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(detail).toContainText("dernières 24 heures");
  await expect(detail.getByRole("link", { name: "Consulter les conversations" })).toBeVisible();
  state = "ready";
  await detail.getByRole("button", { name: "Actualiser les décisions" }).click();
  await expect(page.getByRole("region", { name: "État d’envoi" })).toContainText("La messagerie est désactivée.");
  expect(calls.posts).toHaveLength(0);
});

test("nouvelle tentative en échec : aucune réussite annoncée et observateur sans bouton d’envoi", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/v1/todo/treated", (route) => route.fulfill({ json: { items: [blockedDecision], total: 1, hours: 24 } }));
  let retries = 0;
  await page.route("**/api/v1/conversations/c1/messages/m1/retry-delivery", (route) => {
    retries++;
    return route.fulfill({ status: 503, json: { detail: "Nouvelle tentative indisponible" } });
  });
  await open(page);
  await page.goto("/todo?tab=treated&id=draft%3Ac1%3Am1");
  const delivery = page.getByRole("region", { name: "État d’envoi" });
  await delivery.getByRole("button", { name: "Réessayer l’envoi" }).click();
  await expect(delivery.getByRole("alert")).toContainText("Nouvelle tentative indisponible");
  await expect(delivery.getByRole("status")).toHaveCount(0);
  await expect(delivery.getByRole("heading", { name: "Envoi bloqué" })).toBeVisible();
  expect(retries).toBe(1);
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { id: 7, username: "observateur", role: "VIEWER", email: "v@example.com" } }));
  await page.reload();
  await expect(delivery.getByRole("button", { name: "Actualiser l’état" })).toBeVisible();
  await expect(delivery.getByRole("button", { name: "Réessayer l’envoi" })).toHaveCount(0);
  expect(retries).toBe(1);
});
