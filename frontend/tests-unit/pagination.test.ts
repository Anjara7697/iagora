import assert from "node:assert/strict";
import { test } from "node:test";
import { pageList } from "@/lib/pagination";

test("pageList : toutes les pages jusqu'à 7, sinon début, fin et voisines, 7 positions au plus", () => {
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageList(1, 12), [1, 2, 3, 4, 5, null, 12]);
  assert.deepEqual(pageList(4, 12), [1, 2, 3, 4, 5, null, 12]);
  assert.deepEqual(pageList(6, 12), [1, null, 5, 6, 7, null, 12]);
  assert.deepEqual(pageList(9, 12), [1, null, 8, 9, 10, 11, 12]);
  assert.deepEqual(pageList(12, 12), [1, null, 8, 9, 10, 11, 12]);
  for (let pages = 1; pages <= 40; pages++)
    for (let page = 1; page <= pages; page++) {
      const list = pageList(page, pages);
      assert.ok(list.length <= 7);
      assert.ok(list.includes(page), `page courante ${page}/${pages} affichée`);
      assert.equal(list[0], 1);
      assert.equal(list[list.length - 1], pages);
    }
});
