import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, failure, humanError, qs } from "@/lib/api";

describe("humanError : message lisible par un conseiller", () => {
  test("garde un message métier et retire les identifiants techniques", () => {
    const message = humanError(409, { detail: "Prospect 3fa85f64-5717-4562-b3fc-2c963f66afa6 déjà transféré" });
    assert.equal(message, "Prospect déjà transféré");
  });

  test("ne montre jamais un message technique brut", () => {
    assert.equal(humanError(404, { detail: "Not Found" }), "Élément introuvable : il a peut-être été supprimé ou déplacé.");
    assert.equal(humanError(403, { detail: "Forbidden" }), "Votre rôle ne permet pas cette action.");
  });

  test("validation (422) : nomme le champ en cause en français, pas le message anglais", () => {
    const invalid = { detail: [{ loc: ["body", "email"], msg: "value is not a valid email address", type: "value_error" }] };
    assert.equal(humanError(422, invalid), "Information invalide : « Adresse email ».");
    const missing = { detail: [{ loc: ["body", "first_name"], msg: "Field required", type: "missing" }] };
    assert.equal(humanError(422, missing), "Information manquante : « Prénom ».");
    assert.equal(
      humanError(422, { detail: [{ loc: ["body"], msg: "Field required" }] }),
      "Information manquante ou invalide : vérifiez le formulaire.",
    );
  });

  test("validation (422) : champ d'une liste, plusieurs champs, champ inconnu", () => {
    const nested = { detail: [{ loc: ["body", "sources", 0, "platform"], type: "enum" }] };
    assert.equal(humanError(422, nested), "Information invalide : « Plateforme ».");
    const two = {
      detail: [
        { loc: ["body", "smtp_host"], type: "missing" },
        { loc: ["body", "smtp_port"], type: "missing" },
      ],
    };
    assert.equal(humanError(422, two), "Information manquante : « Serveur SMTP » et « Port SMTP ».");
    const many = {
      detail: ["name", "start_date", "end_date", "email_subject", "champ_interne"].map((f) => ({ loc: ["body", f], type: "value_error" })),
    };
    assert.equal(humanError(422, many), "Information invalide : « Nom », « Date de début », « Date de fin » et 2 autres.");
    // Jamais de nom technique, même pour un champ non répertorié.
    assert.equal(
      humanError(422, { detail: [{ loc: ["body", "champ_interne"], type: "missing" }] }),
      "Information manquante ou invalide : vérifiez le formulaire.",
    );
    assert.equal(
      humanError(422, { detail: [{ loc: ["query", "constructor"], type: "missing" }] }),
      "Information manquante ou invalide : vérifiez le formulaire.",
    );
  });

  test("erreur serveur : message générique et référence de la requête si elle est sûre", () => {
    assert.match(humanError(500, { request_id: "req-42" }), /\(référence req-42\)\.$/);
    const injected = humanError(500, { request_id: "<script>alert(1)</script>" });
    assert.doesNotMatch(injected, /script|référence/);
    assert.doesNotMatch(humanError(502, null), /référence/);
  });

  test("statut sans message connu", () => {
    assert.equal(humanError(418, null), "Erreur 418 : réessayez dans un instant.");
  });
});

test("failure : ce qui a échoué d'abord, puis le détail du serveur", () => {
  assert.equal(failure("Enregistrement impossible", new ApiError(400, "Nom déjà utilisé")), "Enregistrement impossible : Nom déjà utilisé");
  assert.equal(failure("Enregistrement impossible", new Error("réseau")), "Enregistrement impossible.");
});

test("qs : n'envoie que les paramètres renseignés", () => {
  assert.equal(qs({ q: "dupont", stage: "", campaign_id: null, advisor_id: undefined, limit: 25, offset: 0 }), "?q=dupont&limit=25&offset=0");
  assert.equal(qs({ q: "" }), "");
  assert.equal(qs({ q: "a&b=c" }), "?q=a%26b%3Dc");
});

test("ApiError garde le statut HTTP", () => {
  const error = new ApiError(404, "Introuvable");
  assert.equal(error.status, 404);
  assert.equal(error.message, "Introuvable");
  assert.ok(error instanceof Error);
});
