import { useState, useCallback, useRef, useEffect } from "react";
import { api, type ApiError, type SyncResult, type SyncConflictsResponse } from "../lib/api";
import type { ReviewDraft } from "@vice/contracts";

export function useReview(interviewId: string | undefined) {
  const [review, setReview] = useState<ReviewDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [conflicts, setConflicts] = useState<SyncConflictsResponse | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const approveAbortRef = useRef<AbortController | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Abort on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadAbortRef.current?.abort();
      generateAbortRef.current?.abort();
      approveAbortRef.current?.abort();
      syncAbortRef.current?.abort();
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
      const res = await api.getReview(interviewId, ctrl.signal);
      if (mountedRef.current && !ctrl.signal.aborted) setReview(res.data);
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
      const res = await api.generateReview(interviewId, ctrl.signal);
      if (mountedRef.current && !ctrl.signal.aborted) setReview(res.data);
      return res.data;
    } catch (e) {
      if (mountedRef.current && !ctrl.signal.aborted) {
        const error = e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError;
        setError(error);
        throw error;
      }
      throw e;
    } finally {
      if (mountedRef.current && generateAbortRef.current === ctrl) {
        generateAbortRef.current = null;
        setGenerating(false);
      }
    }
  }, [interviewId]);

  const approve = useCallback(
    async (humanDecision: string) => {
      if (!interviewId) return;
      approveAbortRef.current?.abort();
      setApproving(true);
      setError(null);
      const ctrl = new AbortController();
      approveAbortRef.current = ctrl;
      try {
        const res = await api.approveReview(interviewId, { humanDecision }, ctrl.signal);
        if (mountedRef.current && !ctrl.signal.aborted) setReview(res.data);
        return res.data;
      } catch (e) {
        if (mountedRef.current && !ctrl.signal.aborted) {
          const error = e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError;
          setError(error);
          throw error;
        }
        throw e;
      } finally {
        if (mountedRef.current && approveAbortRef.current === ctrl) {
          approveAbortRef.current = null;
          setApproving(false);
        }
      }
    },
    [interviewId],
  );

  const update = useCallback(async (data: Pick<ReviewDraft, "overview" | "strengths" | "risks" | "nextRoundFocus">) => {
    if (!interviewId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateReview(interviewId, data);
      if (mountedRef.current) setReview((current) => ({ ...current, ...res.data } as ReviewDraft));
      return res.data;
    } catch (e) {
      const error = e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError;
      if (mountedRef.current) setError(error);
      throw error;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [interviewId]);

  const exportResult = useCallback(async () => {
    if (!interviewId) return;
    try {
      const res = await api.exportReview(interviewId);
      return res.data;
    } catch (e) {
      setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
      throw e;
    }
  }, [interviewId]);

  // ── Sync methods ──

  const sync = useCallback(async () => {
    if (!interviewId) return;
    syncAbortRef.current?.abort();
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    const ctrl = new AbortController();
    syncAbortRef.current = ctrl;
    try {
      const res = await api.syncReview(interviewId, ctrl.signal);
      if (mountedRef.current && !ctrl.signal.aborted) {
        setSyncResult(res.data);
        if (res.data.status === "sync_conflict") {
          // Also reload conflicts for display
          try {
            const cRes = await api.getSyncConflicts(interviewId, ctrl.signal);
            if (mountedRef.current && !ctrl.signal.aborted) setConflicts(cRes.data);
          } catch { /* ignore */ }
        }
      }
      return res.data;
    } catch (e) {
      if (mountedRef.current && !ctrl.signal.aborted) {
        setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
      }
      throw e;
    } finally {
      if (mountedRef.current && syncAbortRef.current === ctrl) {
        syncAbortRef.current = null;
        setSyncing(false);
      }
    }
  }, [interviewId]);

  const loadConflicts = useCallback(async () => {
    if (!interviewId) return;
    const ctrl = new AbortController();
    try {
      const res = await api.getSyncConflicts(interviewId, ctrl.signal);
      setConflicts(res.data);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
      }
    }
  }, [interviewId]);

  const resolveConflicts = useCallback(async (action: "retry" | "force" | "cancel") => {
    if (!interviewId) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await api.resolveSyncConflicts(interviewId, action);
      setConflicts(null);
      setSyncResult(null);
      return res.data;
    } catch (e) {
      setError(e instanceof Error ? (e as ApiError) : new Error(String(e)) as ApiError);
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [interviewId]);

  return {
    review, loading, error, generating, approving, saving, syncing,
    conflicts, syncResult,
    load, generate, approve, update, exportResult, setReview,
    sync, loadConflicts, resolveConflicts,
  };
}
