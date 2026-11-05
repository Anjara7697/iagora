import { CAMPAIGN_STATUS, STAGES } from "@/lib/labels";

/**
 * État de navigation du module Campagnes, porté par l'URL pour survivre aux allers-retours :
 * - liste : statut, « Mes campagnes », page (`/campaigns?status=draft&mine=true&page=2`) ;
 * - fiche : onglet, étape et page des prospects, et l'URL de la liste d'où l'on vient (`from`).
 * Seules les valeurs connues sont relues ; une URL de retour est toujours reconstruite, jamais suivie telle quelle.
 */
type Query = { get: (key: string) => string | null };

const option = (query: Query, key: string, options: Record<string, string>) => {
  const value = query.get(key) ?? "";
  return Object.hasOwn(options, value) ? value : "";
};
const pageOf = (query: Query) => {
  const page = Number(query.get("page"));
  return Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1;
};
const href = (path: string, values: Record<string, string>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const search = params.toString();
  return `${path}${search ? `?${search}` : ""}`;
};

export function readCampaignList(query: Query) {
  return { status: option(query, "status", CAMPAIGN_STATUS), mine: query.get("mine") === "true", page: pageOf(query) };
}
export type CampaignList = ReturnType<typeof readCampaignList>;

export function campaignListHref(state: CampaignList) {
  return href("/campaigns", { status: state.status, mine: state.mine ? "true" : "", page: state.page > 1 ? String(state.page) : "" });
}

/** Retour vers la liste : uniquement `/campaigns` et ses filtres connus. */
export function campaignListReturnHref(value: string | null) {
  if (value !== "/campaigns" && !value?.startsWith("/campaigns?")) return null;
  return campaignListHref(readCampaignList(new URLSearchParams(value.slice("/campaigns".length))));
}

export const CAMPAIGN_TABS = { overview: "Vue d'ensemble", prospects: "Prospects", sources: "Sources", settings: "Réglages" };
export type CampaignTab = keyof typeof CAMPAIGN_TABS;

export function readCampaignView(query: Query) {
  return {
    tab: (option(query, "tab", CAMPAIGN_TABS) || "overview") as CampaignTab,
    stage: option(query, "stage", STAGES),
    page: pageOf(query),
    from: campaignListReturnHref(query.get("from")),
  };
}
export type CampaignView = ReturnType<typeof readCampaignView>;

export function campaignHref(id: number | string, view: CampaignView) {
  const prospects = view.tab === "prospects";
  return href(`/campaigns/${id}`, {
    tab: view.tab === "overview" ? "" : view.tab,
    stage: prospects ? view.stage : "",
    page: prospects && view.page > 1 ? String(view.page) : "",
    from: view.from && view.from !== "/campaigns" ? view.from : "",
  });
}

/** Retour vers une fiche de campagne (depuis la fiche d'un prospect) : chemin et paramètres reconstruits. */
export function campaignReturnHref(value: string | null) {
  const match = value?.match(/^\/campaigns\/([1-9]\d{0,9})(\?.*)?$/);
  if (!match) return null;
  return campaignHref(match[1], readCampaignView(new URLSearchParams(match[2] ?? "")));
}

export { replaceUrl } from "@/lib/url";
