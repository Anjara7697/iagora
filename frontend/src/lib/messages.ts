import type { Message } from "./types";

/**
 * État du brouillon de l'agent porté par un message (« pending », « approved »…), s'il y en a un (TS-03) :
 * les métadonnées sont libres côté API, leur forme est vérifiée ici une fois, au lieu d'être supposée à chaque
 * lecture.
 */
export function draftStatus(message: Pick<Message, "metadata">): string | undefined {
  const draft = message.metadata.draft;
  if (draft && typeof draft === "object" && "status" in draft && typeof draft.status === "string") return draft.status;
  return undefined;
}
