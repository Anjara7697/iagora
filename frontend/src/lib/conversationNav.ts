import { CHANNELS } from "@/lib/labels";

/**
 * État de Conversations porté par l'adresse : recherche, statut, responsable, canal, page et conversation ouverte
 * (`/conversations?status=handed_off&owner=me`, `?q=dupont&page=2`, `?id=…`). Seules les valeurs connues sont
 * relues ; une valeur inconnue revient au défaut.
 */
type Query = { get: (key: string) => string | null };

export const STATUS_FILTERS = [
  { value: "", text: "Toutes" },
  { value: "handed_off", text: "En attente" },
  { value: "open", text: "Ouvertes" },
  { value: "closed", text: "Clôturées" },
] as const;
export const OWNER_FILTERS = [
  { value: "", text: "Tous" },
  { value: "me", text: "Moi" },
  { value: "none", text: "Non assigné" },
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];
export type OwnerFilter = (typeof OWNER_FILTERS)[number]["value"];

const isStatus = (v: string): v is StatusFilter => STATUS_FILTERS.some((o) => o.value === v);
const isOwner = (v: string): v is OwnerFilter => OWNER_FILTERS.some((o) => o.value === v);

export function readConversationView(query: Query) {
  const status = query.get("status") ?? "";
  const owner = query.get("owner") ?? "";
  const channel = query.get("channel") ?? "";
  const id = query.get("id");
  return {
    q: (query.get("q") ?? "").slice(0, 100),
    status: isStatus(status) ? status : ("" as StatusFilter),
    owner: isOwner(owner) ? owner : ("" as OwnerFilter),
    channel: Object.hasOwn(CHANNELS, channel) ? channel : "",
    page: Math.max(1, Math.floor(Number(query.get("page"))) || 1),
    id: id && id.length <= 100 ? id : null,
  };
}
export type ConversationView = ReturnType<typeof readConversationView>;

export function conversationHref(view: ConversationView) {
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  if (view.status) params.set("status", view.status);
  if (view.owner) params.set("owner", view.owner);
  if (view.channel) params.set("channel", view.channel);
  if (view.page > 1) params.set("page", String(view.page));
  if (view.id) params.set("id", view.id);
  const search = params.toString();
  return `/conversations${search ? `?${search}` : ""}`;
}

/** Un filtre est actif (le compteur dit alors « N sur M » et « Afficher tout » remet la liste complète). */
export const isFiltered = (view: ConversationView) => !!(view.q || view.status || view.owner || view.channel);
