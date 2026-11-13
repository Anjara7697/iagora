import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { composeDocument, slugify, splitDocument } from "@/lib/knowledgeDoc";
import { percent, rateBadge, RATE_THRESHOLDS } from "@/lib/kpi";
import { fullName, initials, isDemoEmail, label, relativeTime, STAGES } from "@/lib/labels";

describe("libellés", () => {
  test("label : traduction, clé inconnue gardée, valeur absente en tiret", () => {
    assert.equal(label(STAGES, "qualified"), STAGES.qualified);
    assert.equal(label(STAGES, "inconnue"), "inconnue");
    assert.equal(label(STAGES, null), "-");
  });

  test("fullName : nom, puis email, puis « (anonyme) »", () => {
    assert.equal(fullName({ first_name: "Marie", last_name: "Dupont", email: "m@example.com" }), "Marie Dupont");
    assert.equal(fullName({ first_name: null, last_name: "Dupont", email: null }), "Dupont");
    assert.equal(fullName({ first_name: null, last_name: null, email: "m@example.com" }), "m@example.com");
    assert.equal(fullName({ first_name: null, last_name: null, email: null }), "(anonyme)");
  });

  test("initials", () => {
    assert.equal(initials("marie dupont"), "MD");
    assert.equal(initials("  "), "?");
  });

  test("isDemoEmail : seule l'adresse réservée aux données fictives", () => {
    assert.equal(isDemoEmail(" Camille@Demo.Example.com "), true);
    assert.equal(isDemoEmail("camille@example.com"), false);
    assert.equal(isDemoEmail("camille@demo.example.com.evil.fr"), false);
    assert.equal(isDemoEmail(null), false);
  });

  test("relativeTime : minutes, heures, jours", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    assert.equal(relativeTime("2026-11-13T11:59:50Z", now), "à l'instant");
    assert.equal(relativeTime("2026-11-13T11:15:00Z", now), "il y a 45 min");
    assert.equal(relativeTime("2026-11-13T10:00:00Z", now), "il y a 2 h");
    assert.equal(relativeTime("2026-11-10T12:00:00Z", now), "il y a 3 j");
    assert.equal(relativeTime("2026-11-13T13:00:00Z", now), "à l'instant", "une date future ne donne pas de durée négative");
    assert.equal(relativeTime(null, now), "-");
  });
});

describe("indicateurs", () => {
  test("percent : entier, zéro sans total", () => {
    assert.equal(percent(5, 12), 42);
    assert.equal(percent(3, 0), 0);
  });

  test("rateBadge : seuils inclus", () => {
    const t = RATE_THRESHOLDS.qualification;
    assert.equal(rateBadge(t.good, t).label, "Bon");
    assert.equal(rateBadge(t.ok, t).label, "Moyen");
    assert.equal(rateBadge(t.ok - 1, t).tone, "danger");
  });
});

describe("documents de la base de connaissances", () => {
  test("slugify : minuscules, sans accents, tirets", () => {
    assert.equal(slugify("Durée du Programme.md"), "duree-du-programme");
    assert.equal(slugify("  --Financement & OPCO--  "), "financement-opco");
  });

  test("en-tête lu comme le backend, autres lignes conservées, aller-retour stable", () => {
    const raw = "---\nTitle: Financement\ntarget: ALL\nversion: 3\n---\n\n## Section\nTexte.\n";
    const parts = splitDocument(raw);
    assert.deepEqual(parts, { title: "Financement", target: "", body: "## Section\nTexte.\n", extra: ["version: 3"] });
    assert.deepEqual(splitDocument(composeDocument(parts)), parts);
  });

  test("document sans en-tête ou en-tête non fermé : corps intact", () => {
    assert.equal(splitDocument("## Section").body, "## Section");
    assert.equal(splitDocument("---\ntitle: x").body, "---\ntitle: x");
  });
});
