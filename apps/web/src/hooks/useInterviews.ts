import { useState, useEffect, useCallback, useRef } from "react";
import { api, type InterviewSummary, type ApiError } from "../lib/api";

export function useInterviews() {
  const [interviews, setInterviews] = useState<InterviewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await api.listInterviews(ctrl.signal);
      setInterviews(res.data);
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await api.listInterviews(ctrl.signal);
        if (!ctrl.signal.aborted) {
          setInterviews(res.data);
          setLoading(false);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
          setLoading(false);
        }
      }
    };
    load();
    return () => ctrl.abort();
  }, []);

  return { interviews, loading, error, refresh };
}
