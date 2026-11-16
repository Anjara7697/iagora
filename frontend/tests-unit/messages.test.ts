import assert from "node:assert/strict";
import { test } from "node:test";
import { draftStatus } from "@/lib/messages";

test("statut du brouillon lu dans les métadonnées d'un message", () => {
  assert.equal(draftStatus({ metadata: { draft: { status: "pending" } } }), "pending");
  assert.equal(draftStatus({ metadata: {} }), undefined, "pas de brouillon");
  assert.equal(draftStatus({ metadata: { draft: null } }), undefined);
  assert.equal(draftStatus({ metadata: { draft: "pending" } }), undefined, "forme inattendue : ignorée");
  assert.equal(draftStatus({ metadata: { draft: { status: 3 } } }), undefined);
});
