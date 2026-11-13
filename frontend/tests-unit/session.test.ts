import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { firstNameOf } from "@/lib/labels";
import { loginHref, returnPath } from "@/lib/session/returnPath";

describe("adresse de retour après la connexion", () => {
  test("garde un écran connu de la console, avec ses paramètres, sans le fragment", () => {
    assert.equal(returnPath("/"), "/");
    assert.equal(returnPath("/prospects/12?tab=journey&from=%2Fprospects"), "/prospects/12?tab=journey&from=%2Fprospects");
    assert.equal(returnPath("/campaigns?status=draft#haut"), "/campaigns?status=draft");
    assert.equal(returnPath("/settings/testing"), "/settings/testing");
  });

  test("refuse tout ce qui n'est pas un écran interne connu", () => {
    for (const unsafe of [
      "https://exemple.com/prospects",
      "//exemple.com/prospects",
      "/\\exemple.com",
      "javascript:alert(1)",
      "prospects",
      "/prospects/../team",
      "/prospects/0",
      "/prospects/abc",
      "/login",
      "/api/v1/auth/me",
      "/inconnu",
      "",
      null,
      undefined,
      `/prospects?q=${"a".repeat(2000)}`,
    ])
      assert.equal(returnPath(unsafe), null, String(unsafe));
  });

  test("loginHref : page de connexion qui ramène à la page en cours", () => {
    assert.equal(loginHref("/prospects/1?tab=journey"), "/login?next=%2Fprospects%2F1%3Ftab%3Djourney");
    assert.equal(loginHref("/"), "/login");
    assert.equal(loginHref("/inconnu"), "/login");
  });
});

test("firstNameOf : prénom affichable à partir de l'identifiant", () => {
  assert.equal(firstNameOf("nadia.cohen"), "Nadia");
  assert.equal(firstNameOf("PAUL@example.com"), "Paul");
  assert.equal(firstNameOf(""), "");
});
