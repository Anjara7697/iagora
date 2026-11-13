"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isAbort } from "./api";
import { sharedGet } from "./sharedGet";
import { WORK_QUEUE_CHANGED } from "./workQueue";

type State<T> = { data: T | null; error: ApiError | null; loading: boolean };

/**
 * Charge une ressource GET. `path` à null : rien à charger. Une même adresse demandée au même moment par plusieurs
 * composants ne part qu'une fois ; changer d'adresse ou quitter l'écran abandonne la requête en cours (`sharedGet`).
 * `reload` relit toujours le serveur, sans reprendre une requête partie avant.
 */
export function useApi<T>(
  path: string | null,
  options: { keepPrevious?: boolean } = {},
) {
  const keepPrevious = options.keepPrevious ?? false;
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    loading: path !== null,
  });
  const [version, setVersion] = useState(0);
  const seenVersion = useRef(version);

  useEffect(() => {
    if (!path || !/^\/todo(?:[/?]|$)/.test(path)) return;
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener(WORK_QUEUE_CHANGED, refresh);
    return () => window.removeEventListener(WORK_QUEUE_CHANGED, refresh);
  }, [path]);

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const fresh = version !== seenVersion.current;
    seenVersion.current = version;
    let cancelled = false;
    // Avec `keepPrevious`, la liste reste affichée pendant le rechargement (filtres, recherche).
    setState((prev) => ({
      data: keepPrevious ? prev.data : null,
      loading: true,
      error: null,
    }));
    const request = sharedGet<T>(path, { fresh });
    request.promise
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled || isAbort(error)) return;
        setState({
          data: null,
          error: error instanceof ApiError ? error : new ApiError(0, "Chargement impossible : réessayez dans un instant."),
          loading: false,
        });
      });
    return () => {
      cancelled = true;
      request.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
