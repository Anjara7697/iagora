"use client";

import { createContext, useContext, useEffect, useState } from "react";

type DraftUpdate = string | ((previous: string) => string);
type DraftsContext = {
  drafts: Record<string, string>;
  update: (id: string, value: DraftUpdate) => void;
};
const Context = createContext<DraftsContext | null>(null);

/** Saisies en mémoire uniquement, limitées à la session de navigation courante. */
export function ReplyDraftsProvider({ children }: { children: React.ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const hasDrafts = Object.values(drafts).some((text) => text.trim());

  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts]);

  function update(id: string, value: DraftUpdate) {
    setDrafts((previous) => {
      const text = typeof value === "function" ? value(previous[id] ?? "") : value;
      const next = { ...previous };
      if (text) next[id] = text;
      else delete next[id];
      return next;
    });
  }

  return <Context.Provider value={{ drafts, update }}>{children}</Context.Provider>;
}

export function useReplyDraft(id: string) {
  const context = useContext(Context);
  if (!context) throw new Error("ReplyDraftsProvider is required");
  return [context.drafts[id] ?? "", (value: DraftUpdate) => context.update(id, value)] as const;
}

/** Vrai si une réponse non envoyée est en cours de saisie quelque part dans l'application. */
export function useHasUnsentReplies() {
  const context = useContext(Context);
  return () => Object.values(context?.drafts ?? {}).some((text) => text.trim());
}

/** Déconnexion avec confirmation quand des réponses non envoyées seraient perdues. */
export function confirmLogoutWithDrafts(hasDrafts: boolean) {
  return !hasDrafts || window.confirm("Vous avez des réponses non envoyées. Se déconnecter les effacera. Continuer ?");
}

export function ReplyLogoutButton({ onLogout }: { onLogout: () => void }) {
  const context = useContext(Context);
  return (
    <button role="menuitem" onClick={() => {
      const hasDrafts = Object.values(context?.drafts ?? {}).some((text) => text.trim());
      if (hasDrafts && !window.confirm("Vous avez des réponses non envoyées. Se déconnecter les effacera. Continuer ?")) return;
      onLogout();
    }}>
      Déconnexion
    </button>
  );
}
