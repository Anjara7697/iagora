import { TARGETS } from "@/lib/labels";
import { SLUG_PATTERN } from "@/lib/knowledgeDoc";

/**
 * État de la Base de connaissances porté par l'adresse : onglet, recherche, programme et document ouvert
 * (`/knowledge?tab=test`, `?q=durée&programme=common&status=reindex`, `?doc=ebihar`). Seules les valeurs connues
 * sont relues.
 */
type Query = { get: (key: string) => string | null };

export const KNOWLEDGE_TABS = { documents: "Documents", test: "Tester une question" };
export type KnowledgeTab = keyof typeof KNOWLEDGE_TABS;

/** Filtre de programme : vide = tous, `common` = documents communs à tous les programmes, sinon un code. */
export const COMMON = "common";

export function readKnowledgeView(query: Query) {
  const tab = query.get("tab");
  const programme = query.get("programme") ?? "";
  const doc = query.get("doc");
  return {
    tab: (tab && Object.hasOwn(KNOWLEDGE_TABS, tab) ? tab : "documents") as KnowledgeTab,
    q: (query.get("q") ?? "").slice(0, 100),
    programme: programme === COMMON || Object.hasOwn(TARGETS, programme) ? programme : "",
    /** `reindex` : seulement les documents à recalculer (vecteurs d'un ancien modèle, ignorés par l'agent). */
    status: query.get("status") === "reindex" ? ("reindex" as const) : ("" as const),
    doc: doc && SLUG_PATTERN.test(doc) ? doc : null,
  };
}
export type KnowledgeView = ReturnType<typeof readKnowledgeView>;

export function knowledgeHref(view: KnowledgeView) {
  const params = new URLSearchParams();
  if (view.tab !== "documents") params.set("tab", view.tab);
  if (view.q) params.set("q", view.q);
  if (view.programme) params.set("programme", view.programme);
  if (view.status) params.set("status", view.status);
  if (view.doc) params.set("doc", view.doc);
  const search = params.toString();
  return `/knowledge${search ? `?${search}` : ""}`;
}
