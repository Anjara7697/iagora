/**
 * Onglet de la fiche prospect, porté par l'URL (`/prospects/1?tab=journey`). Les paramètres de retour (`from`, `task`,
 * `kind`) sont conservés tels quels : les liens de retour les relisent et les reconstruisent eux-mêmes.
 */
type Query = { get: (key: string) => string | null };

export const PROSPECT_TABS = {
  overview: "Vue d'ensemble",
  conversation: "Conversation",
  journey: "Parcours",
  decisions: "Décisions de l'agent",
};
export type ProspectTab = keyof typeof PROSPECT_TABS;

const RETURN_KEYS = ["from", "task", "kind"] as const;

export function readProspectTab(query: Query): ProspectTab {
  const value = query.get("tab") ?? "";
  return Object.hasOwn(PROSPECT_TABS, value) ? (value as ProspectTab) : "overview";
}

export function prospectTabHref(id: number | string, tab: ProspectTab, query: Query) {
  const params = new URLSearchParams();
  if (tab !== "overview") params.set("tab", tab);
  for (const key of RETURN_KEYS) {
    const value = query.get(key);
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return `/prospects/${id}${search ? `?${search}` : ""}`;
}

export { replaceUrl } from "@/lib/url";
