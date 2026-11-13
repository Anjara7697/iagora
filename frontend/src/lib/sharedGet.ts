import { api, onApiWrite } from "./api";

/**
 * Lectures partagées (DATA-02) : deux composants qui demandent la même adresse pendant qu'une requête est en cours
 * reçoivent la même réponse, pour une seule requête (ex. `/todo?limit=1`, lu par la barre du haut et par l'accueil).
 * Une requête partie avant une écriture (POST, PATCH…) n'est plus partagée : la lecture suivante repart au serveur.
 * Une requête est abandonnée quand plus personne ne l'attend (écran quitté, recherche modifiée) : le serveur n'a plus
 * à y répondre et une réponse tardive ne peut plus écraser une plus récente.
 */
type Flight = { promise: Promise<unknown>; controller: AbortController; users: number };

const inflight = new Map<string, Flight>();

onApiWrite(() => inflight.clear());

export function sharedGet<T>(
  path: string,
  { fresh = false }: { fresh?: boolean } = {},
): { promise: Promise<T>; release: () => void } {
  let flight = inflight.get(path);
  // `fresh` : relecture demandée (après une écriture, un rafraîchissement) ; ne pas reprendre une requête plus ancienne.
  if (!flight || fresh) {
    const controller = new AbortController();
    const current: Flight = { promise: Promise.resolve(), controller, users: 0 };
    current.promise = api<T>(path, { signal: controller.signal }).finally(() => {
      if (inflight.get(path) === current) inflight.delete(path);
    });
    inflight.set(path, current);
    flight = current;
  }
  const mine = flight;
  mine.users += 1;
  let released = false;
  return {
    promise: mine.promise as Promise<T>,
    release: () => {
      if (released) return;
      released = true;
      mine.users -= 1;
      if (mine.users === 0 && inflight.get(path) === mine) {
        inflight.delete(path);
        mine.controller.abort();
      }
    },
  };
}
