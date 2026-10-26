"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { WORK_QUEUE_CHANGED } from "./workQueue";

type State<T> = { data: T | null; error: ApiError | null; loading: boolean };

/** Charge une ressource GET. `path` à null : rien à charger. */
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
    let cancelled = false;
    // Avec `keepPrevious`, la liste reste affichée pendant le rechargement (filtres, recherche).
    setState((prev) => ({
      data: keepPrevious ? prev.data : null,
      loading: true,
      error: null,
    }));
    api<T>(path)
      .then(
        (data) => !cancelled && setState({ data, error: null, loading: false }),
      )
      .catch(
        (error: ApiError) =>
          !cancelled && setState({ data: null, error, loading: false }),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
