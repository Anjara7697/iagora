import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import * as logic from "./prospect.mjs";
const workflow = JSON.parse(
  readFileSync(
    new URL("../../docs/n8n/iagora-prospect-gemini.json", import.meta.url),
  ),
);
const cid = "1234567890abcdef12345678";
const config = {
  baseUrl: "http://backend:8000/api/v1",
  model: "gemini-2.5-flash",
  persona: "Camille fictif",
  maxTurns: 8,
  maxPolls: 60,
  maxMinutes: 15,
};
const ok = (body) => ({ statusCode: 200, body });
const initial = () => logic.initial(config, "run-42", 0);

test("export inactif, nœuds valides et connexions résolues, aucun secret ou approbation", () => {
  assert.equal(workflow.active, false);
  const names = new Set(workflow.nodes.map((n) => n.name));
  assert.equal(names.size, workflow.nodes.length);
  for (const [from, outputs] of Object.entries(workflow.connections)) {
    assert(names.has(from));
    for (const group of outputs.main)
      for (const edge of group) assert(names.has(edge.node));
  }
  for (const node of workflow.nodes) {
    assert.equal(node.credentials, undefined);
    if (node.type.endsWith(".code"))
      new vm.Script(
        `(function($input,$,$execution){${node.parameters.jsCode}})`,
      );
    if (node.type.endsWith(".httpRequest")) {
      assert.equal(node.retryOnFail, false);
      assert(!node.parameters.url.includes("/approve"));
      assert.equal(node.parameters.genericAuthType, "httpHeaderAuth");
    }
  }
  const text = JSON.stringify(workflow);
  assert(!text.includes("Bearer ey"));
  assert(!text.includes("AIza"));
});

test("le prompt ne voit que la liste blanche de l’échange, jamais le rapport opérateur", () => {
  const state = logic.exchangeReady(
    { ...initial(), conversationId: cid },
    ok({
      conversation_id: cid,
      status: "open",
      can_continue: true,
      messages: [
        {
          id: "a",
          role: "agent",
          content: "Bonjour",
          metadata: { secret: "HIDDEN" },
          reason: "HIDDEN",
        },
      ],
      guide: "HIDDEN",
    }),
  );
  const planned = logic.plan(
    state,
    ok({ appointments: [], scores: "HIDDEN", guide: "HIDDEN" }),
  );
  const prompt = JSON.stringify(logic.prospectRequest(planned));
  assert(!prompt.includes("HIDDEN"));
  assert(prompt.includes("Bonjour"));
});

test("STOP arrête le jeu malgré status=open et même avec un message en reprise", () => {
  const state = {
    ...initial(),
    conversationId: cid,
    pending: { content: "ancien", externalId: "same" },
  };
  const read = logic.exchangeReady(
    state,
    ok({
      conversation_id: cid,
      status: "open",
      can_continue: false,
      messages: [],
    }),
  );
  assert.equal(logic.plan(read, ok({ appointments: [] })).result, "stopped");
});

test("pas de second appel modèle tant que le message reçu n’a pas changé", () => {
  const state = {
    ...initial(),
    conversationId: cid,
    turn: 1,
    cursor: "a",
    exchange: {
      canContinue: true,
      messages: [{ id: "a", role: "agent", content: "Bonjour" }],
    },
  };
  assert.equal(logic.plan(state, ok({ appointments: [] })).route, "wait");
  state.exchange.messages.push({
    id: "p",
    role: "prospect",
    content: "Question",
  });
  assert.equal(logic.plan(state, ok({ appointments: [] })).route, "wait");
});

test("réservation avant validation : attendre que le prospect reçoive une réponse", () => {
  const state = {
    ...initial(),
    exchange: {
      canContinue: true,
      messages: [{ id: "p", role: "prospect", content: "Créneau 2" }],
    },
  };
  assert.equal(
    logic.plan(state, ok({ appointments: [{ id: 1 }] })).route,
    "wait",
  );
  state.exchange.messages.push({
    id: "a",
    role: "agent",
    content: "Confirmation fictive",
  });
  assert.equal(
    logic.plan(state, ok({ appointments: [{ id: 1 }] })).result,
    "appointment_recorded_reply_received",
  );
});

test("POST incertain : reprise du même contenu et du même identifiant sans nouvelle génération", () => {
  const state = logic.prepared(
    initial(),
    ok({ candidates: [{ content: { parts: [{ text: "Bonjour" }] } }] }),
  );
  const failed = logic.sent(state, { error: "network" });
  const resume = logic.summary(failed).resume;
  resume.conversationId = cid;
  const resumed = logic.initial({ ...config, resume }, "new-execution", 10);
  const ready = { ...resumed, exchange: { canContinue: true, messages: [] } };
  const planned = logic.plan(ready, ok({ appointments: [] }));
  assert.equal(planned.route, "send");
  assert.deepEqual(planned.pending, state.pending);
  assert.equal(planned.pending.externalId, "n8n-run-42-turn-1");
});

test("budget, jeton expiré et sortie Gemini vide ne deviennent pas des succès", () => {
  assert.equal(logic.cycle(initial(), 15 * 60000).result, "time_limit");
  assert.equal(
    logic.prepared(initial(), ok({}), 15 * 60000).result,
    "time_limit",
  );
  assert.equal(logic.plan(initial(), ok({}), 15 * 60000).result, "time_limit");
  assert.equal(
    logic.cycle({ ...initial(), polls: 60 }, 1).result,
    "poll_limit",
  );
  assert.equal(
    logic.plan(
      { ...initial(), turn: 8, exchange: { canContinue: true, messages: [] } },
      ok({ appointments: [] }),
    ).result,
    "turn_limit",
  );
  assert(
    logic
      .checked(initial(), { statusCode: 401 }, "dispatch")
      .result.includes("401"),
  );
  assert.equal(
    logic.prepared(initial(), ok({ candidates: [] })).result,
    "invalid_prospect_response",
  );
  const stopped = logic.sessionReady(initial(), { statusCode: 503 });
  assert.equal(logic.cycle(stopped, 1).result, stopped.result);
});

// Interpréteur de contrôle du JSON généré (pas une instance du moteur n8n).
// Exécute exactement ses nœuds Code/IF et les expressions HTTP ; services en mémoire.
function play({
  bookAfter = 3,
  autoApprove = true,
  loseFirstPost = false,
  maxPolls = 60,
  resume = null,
} = {}) {
  const history = new Map();
  const nodes = new Map(workflow.nodes.map((n) => [n.name, n]));
  let current = "Manual start",
    item = {},
    now = 0,
    steps = 0,
    generations = 0,
    polls = 0;
  const messages = [];
  let queued = null;
  let sent = 0;
  let appointments = [];
  const requestIds = [];
  const $ = (name) => ({ item: { json: history.get(name) } });
  const expression = (text, json) =>
    vm.runInNewContext(`(${text.slice(3, -2)})`, {
      $json: json,
      $,
      encodeURIComponent,
    });
  while (current) {
    assert(++steps < 2000, "boucle non bornée");
    const node = nodes.get(current);
    let output = 0;
    if (node.type.endsWith(".manualTrigger")) item = {};
    else if (node.type.endsWith(".code")) {
      const Clock = class extends Date {
        static now() {
          return now;
        }
      };
      const fn = vm.runInNewContext(
        `(function($input,$,$execution){${node.parameters.jsCode}})`,
        { Date: Clock },
      );
      item = fn({ first: () => ({ json: item }) }, $, { id: "run-test" })[0]
        .json;
      if (current === "Configuration")
        item = logic.initial({ ...config, maxPolls, resume }, "run-test", now);
    } else if (node.type.endsWith(".if")) {
      const c = node.parameters.conditions.conditions[0];
      output = expression(c.leftValue, item) === c.rightValue ? 0 : 1;
    } else if (node.type.endsWith(".wait")) now += 15000;
    else if (node.type.endsWith(".httpRequest")) {
      const url = expression(node.parameters.url, item);
      const body = node.parameters.jsonBody
        ? expression(node.parameters.jsonBody, item)
        : null;
      if (current === "Create session")
        item = { statusCode: 201, body: { conversation_id: cid } };
      else if (current === "Dispatch") {
        polls++;
        if (queued && autoApprove && polls % 3 === 0) {
          messages.push(queued);
          queued = null;
        }
        item = ok({});
      } else if (current === "Read exchange")
        item = ok({
          conversation_id: cid,
          status: "open",
          can_continue: true,
          messages: JSON.parse(JSON.stringify(messages)),
        });
      else if (current === "Read report")
        item = ok({
          appointments,
          guide: "OPERATOR_PRIVATE",
          scores: "OPERATOR_PRIVATE",
        });
      else if (current === "Gemini prospect") {
        assert(url.includes("generativelanguage.googleapis.com"));
        assert(!JSON.stringify(body).includes("OPERATOR_PRIVATE"));
        assert(!JSON.stringify(body).includes("DRAFT_PRIVATE"));
        generations++;
        item = ok({
          candidates: [
            {
              content: { parts: [{ text: `Message prospect ${generations}` }] },
            },
          ],
        });
      } else if (current === "Send prospect") {
        requestIds.push(body.external_message_id);
        messages.push({
          id: `p${++sent}`,
          role: "prospect",
          content: body.content,
        });
        queued = {
          id: `a${sent}`,
          role: "agent",
          content: `Réponse reçue ${sent}`,
        };
        if (sent === bookAfter) appointments = [{ id: 1 }];
        item =
          loseFirstPost && sent === 1
            ? { error: "timeout" }
            : ok({ internal: "DRAFT_PRIVATE" });
      } else throw new Error(`HTTP non prévu ${current}`);
    } else throw new Error(`Type non prévu ${node.type}`);
    history.set(current, item);
    const edges = workflow.connections[current]?.main[output] ?? [];
    assert(edges.length <= 1, "embranchement parallèle non prévu");
    current = edges[0]?.node;
  }
  return { item, generations, polls, sent, requestIds };
}

test("JSON complet : parcours, attente humaine, réservation et réponse reçue", () => {
  const r = play();
  assert.equal(r.item.result, "appointment_recorded_reply_received");
  assert.equal(r.sent, 3);
  assert.equal(r.generations, 3);
  assert(r.polls > r.generations);
  assert.equal(new Set(r.requestIds).size, 3);
});

test("JSON complet : pas de validation humaine, pas de deuxième tour", () => {
  const r = play({ autoApprove: false, maxPolls: 4 });
  assert.equal(r.item.result, "poll_limit");
  assert.equal(r.generations, 1);
  assert.equal(r.sent, 1);
});

test("JSON complet : timeout de POST conserve le message à reprendre", () => {
  const r = play({ loseFirstPost: true });
  assert(r.item.result.includes("network"));
  assert.equal(r.item.resume.pending.externalId, r.requestIds[0]);
  assert.equal(r.generations, 1);
});
