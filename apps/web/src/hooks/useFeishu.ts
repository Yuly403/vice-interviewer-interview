/**
 * Feishu meeting binding and capture status.
 *
 * The hook deliberately rethrows mutation failures. The caller owns the
 * visible interview state, so it must only mutate that state after the API
 * operation has actually succeeded.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { api, type CaptureStatus, type PostMeetingResult } from "../lib/api";
import { useToast } from "./useToast";

export function useFeishu(interviewId: string | undefined) {
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const [binding, setBinding] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const toast = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!interviewId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.getCaptureStatus(interviewId);
        if (!cancelled) setCaptureStatus(res.data);
      } catch (error) {
        console.warn("[useFeishu] capture poll failed:", (error as Error).message);
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 3_000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [interviewId]);

  const bindMeeting = useCallback(async (meetingId: string) => {
    if (!interviewId) throw new Error("Interview id is required");
    setBinding(true);
    try {
      const res = await api.bindMeetingV2(interviewId, meetingId, {
        autoStart: true,
        confirmCandidateAndRound: true,
      });
      const status = await api.getCaptureStatus(interviewId);
      setCaptureStatus(status.data);
      toast.success("会议已绑定，字幕采集已启动");
      return res.data;
    } catch (error) {
      toast.error(`绑定失败：${(error as Error).message}`);
      throw error;
    } finally {
      setBinding(false);
    }
  }, [interviewId, toast]);

  const unbindMeeting = useCallback(async () => {
    if (!interviewId) throw new Error("Interview id is required");
    try {
      await api.unbindMeeting(interviewId);
      setCaptureStatus(null);
      toast.info("已解除会议绑定");
    } catch (error) {
      toast.error("解除绑定失败");
      throw error;
    }
  }, [interviewId, toast]);

  const restartCapture = useCallback(async () => {
    if (!interviewId) return;
    try {
      const res = await api.restartCapture(interviewId);
      setCaptureStatus(res.data);
      toast.success("采集已重启");
    } catch {
      toast.error("重启失败");
    }
  }, [interviewId, toast]);

  const reconcile = useCallback(async (): Promise<PostMeetingResult | null> => {
    if (!interviewId) return null;
    setReconciling(true);
    try {
      const result = (await api.reconcileMeeting(interviewId)).data;
      if (result.error) toast.error(`补拉失败：${result.error}`);
      else toast.success(`补拉完成：新增 ${result.imported} 条，更新 ${result.updated} 条`);
      return result;
    } catch {
      toast.error("补拉失败");
      return null;
    } finally {
      setReconciling(false);
    }
  }, [interviewId, toast]);

  return { captureStatus, binding, reconciling, bindMeeting, unbindMeeting, restartCapture, reconcile };
}
