import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = new URL(".", import.meta.url);
const source = readFileSync(new URL("prospect.mjs", here), "utf8").replaceAll(
  "export function ",
  "function ",
);
const nodes = [];
const connections = {};
const add = (name, type, typeVersion, parameters, position, extra = {}) =>
  nodes.push({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    type: `n8n-nodes-base.${type}`,
    typeVersion,
    parameters,
    position,
    ...extra,
  });
const link = (from, to, output = 0) => {
  const outputs = (connections[from] ??= { main: [] }).main;
  while (outputs.length <= output) outputs.push([]);
  outputs[output].push({ node: to, type: "main", index: 0 });
};
const code = (name, script, x, y) =>
  add(
    name,
    "code",
    2,
    {
      jsCode:
        name === "Configuration"
          ? `${script}\n${source}`
          : `${source}\n${script}`,
    },
    [x, y],
  );
const paired = (name) => `$('${name}').item.json`;
const result = (expression) => `return [{json: ${expression}}];`;
const gate = (name, left, right, x, y) =>
  add(
    name,
    "if",
    2.2,
    {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: name,
            leftValue: left,
            rightValue: right,
            operator: { type: "string", operation: "equals" },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    [x, y],
  );
const request = (name, method, url, body, x, y) =>
  add(
    name,
    "httpRequest",
    4.2,
    {
      method,
      url,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      ...(body ? { sendBody: true, specifyBody: "json", jsonBody: body } : {}),
      options: {
        timeout: 120000,
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
      },
    },
    [x, y],
    { onError: "continueRegularOutput", retryOnFail: false },
  );
add("Manual start", "manualTrigger", 1, {}, [0, 0]);
code(
  "Configuration",
  `const config = {
  baseUrl: 'https://dev.iagora.neosolve.info/api/v1', // API à déployer et vérifier avant exécution
  conversationId: '', // Vide : nouvelle session ; sinon identifiant existant
  model: 'gemini-2.5-flash',
  persona: 'Camille, Bac+3 en informatique, souhaite devenir data analyst en alternance ; craint de ne pas trouver d’entreprise.',
  maxTurns: 8, maxPolls: 60, maxMinutes: 15,
  resume: null, // Pour reprendre un POST incertain : recopier l’objet resume du bilan précédent
};
${result("initial(config, $execution.id, Date.now())")}`,
  220,
  0,
);
gate(
  "Existing session",
  '={{ $json.conversationId ? "yes" : "no" }}',
  "yes",
  440,
  0,
);
request(
  "Create session",
  "POST",
  '={{ $json.baseUrl + "/simulation/sessions" }}',
  '={{ {first_name: "Camille"} }}',
  660,
  160,
);
code(
  "Session ready",
  result(`sessionReady(${paired("Configuration")}, $input.first().json)`),
  880,
  160,
);
code("Cycle", result("cycle($input.first().json, Date.now())"), 1100, 0);
gate("Within budget", "={{ $json.route }}", "continue", 1320, 0);
request(
  "Dispatch",
  "POST",
  '={{ $json.baseUrl + "/simulation/" + $json.conversationId + "/dispatch" }}',
  null,
  1540,
  0,
);
code(
  "Dispatch checked",
  result(`checked(${paired("Cycle")}, $input.first().json, 'dispatch')`),
  1760,
  0,
);
gate("Dispatch OK", "={{ $json.route }}", "continue", 1980, 0);
request(
  "Read exchange",
  "GET",
  '={{ $json.baseUrl + "/simulation/" + $json.conversationId + "/exchange" }}',
  null,
  2200,
  0,
);
code(
  "Exchange checked",
  result(`exchangeReady(${paired("Dispatch checked")}, $input.first().json)`),
  2420,
  0,
);
gate("Exchange OK", "={{ $json.route }}", "continue", 2640, 0);
request(
  "Read report",
  "GET",
  '={{ $json.baseUrl + "/simulation/" + $json.conversationId + "/report" }}',
  null,
  2860,
  0,
);
code(
  "Plan turn",
  result(
    `plan(${paired("Exchange checked")}, $input.first().json, Date.now())`,
  ),
  3080,
  0,
);
gate("Wait for reply", "={{ $json.route }}", "wait", 3300, 0);
add(
  "Wait",
  "wait",
  1.1,
  { resume: "timeInterval", amount: 15, unit: "seconds" },
  [3520, -220],
);
gate("Replay pending", "={{ $json.route }}", "send", 3520, 0);
gate("Generate next turn", "={{ $json.route }}", "generate", 3740, 160);
request(
  "Gemini prospect",
  "POST",
  '={{ "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent($json.model) + ":generateContent" }}',
  "={{ (" + prospectBodyExpression() + ") }}",
  3960,
  160,
);
function prospectBodyExpression() {
  // La préparation du prompt se fait dans un nœud Code explicite pour garder le JSON HTTP simple.
  return "$json.prospectRequest";
}
code(
  "Prospect prompt",
  `const state = $input.first().json; ${result("({...state, prospectRequest: prospectRequest(state)})")}`,
  3960,
  0,
);
code(
  "Prepare message",
  result(
    `prepared(${paired("Prospect prompt")}, $input.first().json, Date.now())`,
  ),
  4180,
  160,
);
gate("Message ready", "={{ $json.route }}", "send", 4400, 160);
code("Outbox", result("$input.first().json"), 4620, 0);
request(
  "Send prospect",
  "POST",
  '={{ $json.baseUrl + "/simulation/" + $json.conversationId + "/messages" }}',
  "={{ {content: $json.pending.content, external_message_id: $json.pending.externalId} }}",
  4840,
  0,
);
code(
  "Message checked",
  result(`sent(${paired("Outbox")}, $input.first().json)`),
  5060,
  0,
);
gate("Message accepted", "={{ $json.route }}", "continue", 5280, 0);
code("Result", result("summary($input.first().json)"), 5500, 300);
link("Manual start", "Configuration");
link("Configuration", "Existing session");
link("Existing session", "Cycle");
link("Existing session", "Create session", 1);
link("Create session", "Session ready");
link("Session ready", "Cycle");
link("Cycle", "Within budget");
link("Within budget", "Dispatch");
link("Within budget", "Result", 1);
link("Dispatch", "Dispatch checked");
link("Dispatch checked", "Dispatch OK");
link("Dispatch OK", "Read exchange");
link("Dispatch OK", "Result", 1);
link("Read exchange", "Exchange checked");
link("Exchange checked", "Exchange OK");
link("Exchange OK", "Read report");
link("Exchange OK", "Result", 1);
link("Read report", "Plan turn");
link("Plan turn", "Wait for reply");
link("Wait for reply", "Wait");
link("Wait", "Cycle");
link("Wait for reply", "Replay pending", 1);
link("Replay pending", "Outbox");
link("Replay pending", "Generate next turn", 1);
link("Generate next turn", "Prospect prompt");
link("Generate next turn", "Result", 1);
link("Prospect prompt", "Gemini prospect");
link("Gemini prospect", "Prepare message");
link("Prepare message", "Message ready");
link("Message ready", "Outbox");
link("Message ready", "Result", 1);
link("Outbox", "Send prospect");
link("Send prospect", "Message checked");
link("Message checked", "Message accepted");
link("Message accepted", "Cycle");
link("Message accepted", "Result", 1);
const workflow = {
  name: "IAGORA — prospect Gemini (dev uniquement)",
  nodes,
  connections,
  active: false,
  settings: { executionOrder: "v1", executionTimeout: 2100 },
  pinData: {},
  tags: [],
};
const destination = new URL("../../docs/n8n/iagora-prospect-gemini.json", here);
const output = JSON.stringify(workflow, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== output)
    throw new Error("Workflow à régénérer : node tools/n8n/build.mjs");
} else writeFileSync(destination, output);
console.log(`${nodes.length} nœuds : ${fileURLToPath(destination)}`);
