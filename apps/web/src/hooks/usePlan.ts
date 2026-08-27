import { useState, useCallback, useRef, useEffect } from "react";
import { api, type ApiError, type GeneratedInterviewPlan } from "../lib/api";
import type { Topic } from "@vice/contracts";

export function usePlan(interviewId: string | undefined) {
  const [plan, setPlan] = useState<GeneratedInterviewPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [generating, setGenerating] = useState(false);
  const loadAbortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const confirmAbortRef = useRef<AbortController | null>(null);
  const updateAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Abort on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadAbortRef.current?.abort();
      generateAbortRef.current?.abort();
      confirmAbortRef.current?.abort();
      updateAbortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    if (!interviewId) return;
    loadAbortRef.current?.abort();
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    loadAbortRef.current = ctrl;
    try {
      const res = await api.getPlan(interviewId, ctrl.signal);
      if (mountedRef.current && !ctrl.signal.aborted) setPlan(res.data);
    } catch (e) {
      if (mountedRef.current && !ctrl.signal.aborted) {
        setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
      }
    } finally {
      if (mountedRef.current && loadAbortRef.current === ctrl) {
        loadAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [interviewId]);

  const generate = useCallback(async () => {
    if (!interviewId) return;
    generateAbortRef.current?.abort();
    setGenerating(true);
    setError(null);
    const ctrl = new AbortController();
    generateAbortRef.current = ctrl;
    try {
      const res = await api.generatePlan(interviewId, ctrl.signal);
      if (mountedRef.current && !ctrl.signal.aborted) {
        setPlan(res.data);
        return res.data;
      }
    } catch (e) {
      if (mountedRef.current && !ctrl.signal.aborted) {
        const err = e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError;
        setError(err);
        throw err;
      }
    } finally {
      if (mountedRef.current && generateAbortRef.current === ctrl) {
        generateAbortRef.current = null;
        setGenerating(false);
      }
    }
  }, [interviewId]);

  const confirm = useCallback(async () => {
    if (!interviewId) return;
    confirmAbortRef.current?.abort();
    setError(null);
    const ctrl = new AbortController();
    confirmAbortRef.current = ctrl;
    try {
      if (!plan) return;
      const res = await api.confirmPlan(interviewId, plan.revision, ctrl.signal);
      if (mountedRef.current && !ctrl.signal.aborted) {
        setPlan((current) => ({
          ...res.data,
          topics: Array.isArray(res.data.topics) ? res.data.topics : (current?.topics ?? []),
          generation: current?.generation ?? null,
        }));
      }
    } catch (e) {
      if (mountedRef.current && !ctrl.signal.aborted) {
        const err = e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError;
        setError(err);
        throw err;
      }
    } finally {
      if (confirmAbortRef.current === ctrl) confirmAbortRef.current = null;
    }
  }, [interviewId, plan]);

  const update = useCallback(
    async (topics: Topic[]) => {
      if (!interviewId) return;
      updateAbortRef.current?.abort();
      setError(null);
      const ctrl = new AbortController();
      updateAbortRef.current = ctrl;
      try {
        if (!plan) return;
        const res = await api.updatePlan(interviewId, topics, plan.revision, ctrl.signal);
        if (mountedRef.current && !ctrl.signal.aborted) {
          setPlan((current) => ({ ...res.data, generation: current?.generation ?? null }));
        }
      } catch (e) {
        if (mountedRef.current && !ctrl.signal.aborted) {
          const err = e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError;
          setError(err);
          throw err;
        }
      } finally {
        if (updateAbortRef.current === ctrl) updateAbortRef.current = null;
      }
    },
    [interviewId, plan],
  );

  return { plan, loading, error, generating, load, generate, confirm, update, setPlan };
}
