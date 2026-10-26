import { CHANNELS, CONSENT, LEVELS, STAGES, TARGETS } from "@/lib/labels";

type Query = { get: (key: string) => string | null };
const option = (query: Query, key: string, options: Record<string, string>) => {
  const value = query.get(key) ?? "";
  return Object.hasOwn(options, value) ? value : "";
};
const positiveId = (value: string | null) =>
  value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? value
    : "";

/** Only supported list settings are carried between the results and a profile. */
export function readProspectResults(query: Query) {
  const campaign = positiveId(query.get("campaign"));
  const offset = Number(query.get("offset"));
  return {
    q: query.get("q") ?? "",
    stage: option(query, "stage", STAGES),
    campaign,
    sourceFilter: campaign ? positiveId(query.get("source")) : "",
    pendingCampaign: query.get("pending_campaign") === "true",
    hideDemo: query.get("demo") === "exclude",
    targetCode: option(query, "target_code", TARGETS),
    levelFilter: option(query, "level", LEVELS),
    channelFilter: option(query, "channel", CHANNELS),
    consentFilter: option(query, "consent_status", CONSENT),
    mine: query.get("mine") === "true",
    view: query.get("view") === "table" ? ("table" as const) : ("pipeline" as const),
    offset:
      Number.isSafeInteger(offset) && offset >= 0 && offset <= 2147483647
        ? offset
        : 0,
  };
}
export type ProspectResults = ReturnType<typeof readProspectResults>;

export function prospectResultsHref(state: ProspectResults) {
  const params = new URLSearchParams();
  const values = {
    q: state.q,
    stage: state.stage,
    campaign: state.campaign,
    source: state.campaign ? state.sourceFilter : "",
    pending_campaign: state.pendingCampaign ? "true" : "",
    demo: state.hideDemo ? "exclude" : "",
    target_code: state.targetCode,
    level: state.levelFilter,
    channel: state.channelFilter,
    consent_status: state.consentFilter,
    mine: state.mine ? "true" : "",
    view: state.view === "table" ? "table" : "",
    offset: state.offset ? String(state.offset) : "",
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return `/prospects${search ? `?${search}` : ""}`;
}

/** Never use a supplied return URL as an arbitrary navigation destination. */
export function prospectReturnHref(value: string | null) {
  if (value !== "/prospects" && !value?.startsWith("/prospects?")) return null;
  const query = value === "/prospects" ? "" : value.slice("/prospects?".length);
  return prospectResultsHref(readProspectResults(new URLSearchParams(query)));
}
