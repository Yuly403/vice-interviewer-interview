import { useState, useEffect, useCallback, useRef } from "react";
import { api, type InterviewDetail, type ApiError } from "../lib/api";

export function useInterview(id: string | undefined) {
  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await api.getInterview(id, ctrl.signal);
      if (!ctrl.signal.aborted) setInterview(res.data);
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
      }
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const ctrl = new AbortController();
    api.getInterview(id, ctrl.signal)
      .then((res) => {
        if (!ctrl.signal.aborted) {
          setInterview(res.data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
          setLoading(false);
        }
      });
    return () => ctrl.abort();
  }, [id]);

  return { interview, loading, error, refresh, setInterview };
}
