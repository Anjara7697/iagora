"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

type State<T> = { data: T | null; error: ApiError | null; loading: boolean };

/** Charge une ressource GET. `path` à null : rien à charger. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: path !== null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch(
        (error: ApiError) => !cancelled && setState({ data: null, error, loading: false }),
      );
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
