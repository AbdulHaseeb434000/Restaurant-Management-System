"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

type Params = Record<string, string | number | boolean | null | undefined>;

/** Fetch a GET endpoint, refetching when path/params change. */
export function useApi<T>(path: string | null, params?: Params, opts?: { refreshMs?: number }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const key = path ? `${path}?${JSON.stringify(params ?? {})}` : null;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const res = await api.get<T>(path, paramsRef.current);
      setData(res);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    reload();
    if (opts?.refreshMs) {
      const t = setInterval(reload, opts.refreshMs);
      return () => clearInterval(t);
    }
  }, [reload, opts?.refreshMs]);

  return { data, error, loading, reload, setData };
}
