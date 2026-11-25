import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { activityTag, activityTitle, ACTIVE_POLL_MS, IDLE_POLL_MS, pollDelay, shortDuration } from "@/lib/agentActivity";
import type { AgentActivity } from "@/lib/types";

const NOW = Date.parse("2027-03-03T09:00:00Z");
const base: AgentActivity = { conversation_id: "c1", prospect_id: 1, state: "running", steps: [] };

describe("journal en direct de l'agent", () => {
  test("shortDuration : secondes, minutes et secondes, minutes", () => {
    assert.equal(shortDuration(8_000), "8 s");
    assert.equal(shortDuration(100_000), "1 min 40");
    assert.equal(shortDuration(180_000), "3 min");
  });

  test("activityTitle : étape en cours, attente des emails, mode manuel", () => {
    const running = {
      ...base,
      steps: [
        { node: "qualify_prospect", label: "Analyse du message", status: "done" as const, started_at: "2027-03-03T08:59:50Z" },
        { node: "generate_response", label: "Recherche dans la base et rédaction de la réponse", status: "running" as const, started_at: "2027-03-03T08:59:55Z" },
      ],
    };
    assert.equal(activityTitle(running, NOW), "L’agent travaille : recherche dans la base et rédaction de la réponse");
    const grouping = { ...base, state: "waiting" as const, waiting_reason: "grouping" as const, next_attempt_at: "2027-03-03T09:01:40Z" };
    assert.equal(activityTitle(grouping, NOW), "En attente d’autres emails du prospect (encore 1 min 40)");
    const manual = { ...base, state: "waiting" as const, waiting_reason: "manual_mode" as const };
    assert.match(activityTitle(manual, NOW), /mode manuel/);
  });

  test("relecture rapide seulement quand quelque chose va bouger", () => {
    assert.equal(pollDelay(base), ACTIVE_POLL_MS);
    assert.equal(pollDelay({ state: "waiting", waiting_reason: "grouping" }), ACTIVE_POLL_MS);
    assert.equal(pollDelay({ state: "waiting", waiting_reason: "manual_mode" }), IDLE_POLL_MS);
    assert.equal(pollDelay({ state: "done" }), IDLE_POLL_MS);
    assert.equal(pollDelay(null), IDLE_POLL_MS);
  });

  test("activityTag : pastille courte de la liste", () => {
    assert.equal(activityTag({ state: "running" }), "L’agent rédige…");
    assert.equal(activityTag({ state: "waiting", waiting_reason: "grouping" }), "Regroupe les emails");
  });
});
