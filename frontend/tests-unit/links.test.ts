import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isHttpsUrl } from "@/lib/links";

describe("liens validés d'une campagne (D-39)", () => {
  test("seule une adresse https complète est acceptée", () => {
    assert.equal(isHttpsUrl("https://www.datumacademy.com/fr/masters/eBIHAR"), true);
    assert.equal(isHttpsUrl("  https://datum.example  "), true);
    for (const bad of ["", "http://datum.example", "datum.example", "javascript:alert(1)", "https://a b.example", "https://"]) {
      assert.equal(isHttpsUrl(bad), false, bad);
    }
  });
});
