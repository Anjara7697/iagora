import assert from "node:assert/strict";
import { test } from "node:test";

import { campaignEnded } from "@/lib/campaignDates";

test("le jour de fin est inclus, en heure de Paris", () => {
  const end = "2026-12-15T00:00:00Z";
  assert.equal(campaignEnded(end, new Date("2026-12-15T01:00:00Z")), false);
  assert.equal(campaignEnded(end, new Date("2026-12-15T22:30:00Z")), false); // 23 h 30 à Paris
  assert.equal(campaignEnded(end, new Date("2026-12-15T23:30:00Z")), true); // 16 déc. à Paris
  assert.equal(campaignEnded(null), false);
});
