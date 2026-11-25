import assert from "node:assert/strict";
import { test } from "node:test";
import { readSort, sortParam, sortState } from "@/lib/sorting";

test("readSort : seuls les champs prévus, croissant ou décroissant", () => {
  assert.equal(readSort("name", ["name", "status"]), "name");
  assert.equal(readSort("-status", ["name", "status"]), "-status");
  assert.equal(readSort("--name", ["name"]), "");
  assert.equal(readSort("leads", ["name", "status"]), "");
  assert.equal(readSort(null, ["name"]), "");
});

test("sortState et sortParam : aller-retour entre l'URL et le tableau", () => {
  assert.equal(sortState(""), null);
  assert.deepEqual(sortState("-created_at"), { column: "created_at", direction: "descending" });
  assert.deepEqual(sortState("name"), { column: "name", direction: "ascending" });
  for (const param of ["name", "-name", "created_at", "-created_at"]) assert.equal(sortParam(sortState(param)!), param);
});
