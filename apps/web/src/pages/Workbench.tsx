import { useEffect, useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useInterview, usePlan, useReview, useFeishu } from "../hooks";
import { useToast } from "../hooks/useToast";
import { Badge, PageSpinner } from "../components/ui";
import { getRoundLabel } from "../lib/mappings";
import LeftPanel from "./components/LeftPanel";
import CenterPanel from "./components/CenterPanel";
import RightPanel from "./components/RightPanel";
import MeetingBinder from "./components/MeetingBinder";
import { api } from "../lib/api";
import type { TranscriptLine, LiveSuggestion } from "@vice/contracts";
import "./Workbench.css";

function formatScheduledAt(value: string, durationMinutes: number) {
  const date = new Date(value);
  const time = Number.isNaN(date.getTime()) ? "时间待确认" : date.toLocaleString("zh-CN");
  return `${time} / ${durationMinutes || 0} 分钟`;
}

export default function Workbench() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { interview, loading: ivLoading, error: interviewError, refresh: refreshInterview, setInterview } = useInterview(id);
  const { plan, generating: planGenerating, load: loadPlan, generate: generatePlan, confirm: confirmPlan } = usePlan(id);
  const { review, generating: reviewGenerating, load: loadReview, generate: generateReview, approve: approveReview, update: updateReview, exportResult, syncing, conflicts, syncResult, sync, loadConflicts, resolveConflicts } = useReview(id);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<LiveSuggestion[]>([]);
  const { captureStatus, binding: meetingBinding, bindMeeting, unbindMeeting, restartCapture, reconcile } = useFeishu(id);

  useEffect(() => {
    if (!id || !interview) return;
    void loadPlan();
    void loadReview();
    const ctrl = new AbortController();
    api.getTranscript(id, undefined, ctrl.signal).then((res) => setTranscript(res.data)).catch((error) => {
      if (!ctrl.signal.aborted) console.error("[Workbench] transcript load failed:", error);
    });
    return () => ctrl.abort();
  }, [id, interview?.status, loadPlan, loadReview]);

  useEffect(() => {
    if (!id) return;
    return api.subscribeEvents(id, (event, data) => {
      if (event === "transcript.line.upserted") {
        const line = data as TranscriptLine;
        setTranscript((prev) => prev.some((item) => item.id === line.id) ? prev.map((item) => item.id === line.id ? line : item) : [...prev, line]);
      }
      if (event === "live.suggestion.created") {
        const suggestion = data as LiveSuggestion;
        setSuggestions((prev) => prev.some((item) => item.id === suggestion.id) ? prev : [...prev, suggestion].filter((item) => new Date(item.expiresAt).getTime() > Date.now()).slice(-20));
      }
      if (event === "interview.status.changed") {
        const status = data as { interviewId: string; status: string };
        if (status.interviewId === id) setInterview((prev) => prev ? { ...prev, status: status.status } : prev);
      }
      if (event === "review.draft.ready") {
        void loadReview();
        toast.info("面评草稿已生成");
      }
    });
  }, [id, loadReview, setInterview, toast]);

  const handleGeneratePlan = useCallback(async () => {
    try {
      const generated = await generatePlan();
      toast[generated?.generation?.mode === "rule-based" ? "info" : "success"](generated?.generation?.mode === "rule-based" ? "模型暂不可用，已按规则模板生成计划" : "面试计划已生成");
    } catch { toast.error("面试计划生成失败，请稍后重试"); }
  }, [generatePlan, toast]);

  const handleConfirmPlan = useCallback(async () => {
    try { await confirmPlan(); toast.success("面试计划已确认"); }
    catch { toast.error("面试计划确认失败，请稍后重试"); }
  }, [confirmPlan, toast]);

  const handleGenerateReview = useCallback(async () => {
    try { await generateReview(); toast.success("面评草稿已生成"); }
    catch (error) { console.error("[Workbench] review generation failed:", error); toast.error("面评草稿生成失败，请稍后重试"); throw error; }
  }, [generateReview, toast]);

  const handleApproveReview = useCallback(async (decision: string) => {
    try { await approveReview(decision); toast.success("面评已确认"); }
    catch (error) { console.error("[Workbench] review approval failed:", error); toast.error("面评确认失败，请检查证据和当前状态后重试"); throw error; }
  }, [approveReview, toast]);

  const handleUpdateReview = useCallback(async (data: Parameters<typeof updateReview>[0]) => {
    try { await updateReview(data); toast.success("面评草稿已保存为新版本"); }
    catch (error) { console.error("[Workbench] review update failed:", error); toast.error("面评修改保存失败，请稍后重试"); throw error; }
  }, [updateReview, toast]);

  const handleExportReview = useCallback(async () => {
    try {
      const data = await exportResult();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `InterviewResult-${id}.json`; link.click(); URL.revokeObjectURL(url);
      toast.success("已导出面试结果包");
    } catch { toast.error("导出失败，请稍后重试"); }
  }, [exportResult, id, toast]);

  const handleSync = useCallback(async () => {
    try {
      const result = await sync();
      if (result?.status === "synced") { toast.success("归档完成，面评已写入候选人档案"); void loadReview(); }
      else if (result?.status === "sync_conflict") toast.warning("检测到归档冲突，请处理后再重试");
      return result;
    } catch { toast.error("归档失败，请稍后重试"); return undefined; }
  }, [sync, loadReview, toast]);

  const handleResolveConflicts = useCallback(async (action: "retry" | "force" | "cancel") => {
    try { await resolveConflicts(action); toast.success(action === "cancel" ? "已取消本次归档" : "冲突已处理，可重新归档"); if (action === "cancel") void loadReview(); }
    catch { toast.error("冲突处理失败，请稍后重试"); }
  }, [resolveConflicts, loadReview, toast]);

  const handleBind = useCallback(async (meetingId: string) => {
    try {
      const result = await bindMeeting(meetingId);
      setInterview((prev) => prev ? { ...prev, feishuMeetingId: result.feishuMeetingId, status: result.status } : prev);
      return true;
    } catch { return false; }
  }, [bindMeeting, setInterview]);

  const handleUnbind = useCallback(async () => {
    try {
      await unbindMeeting();
      setInterview((prev) => prev ? { ...prev, feishuMeetingId: null, status: prev.status === "bound" ? "ready" : prev.status } : prev);
    } catch { /* Hook already displays the API failure. */ }
  }, [unbindMeeting, setInterview]);

  const handleReconcile = useCallback(async () => {
    const result = await reconcile();
    if (result && id) setTranscript((await api.getTranscript(id)).data);
  }, [reconcile, id]);

  const handleSuggestionFeedback = useCallback(async (suggestionId: string, feedback: string) => {
    if (!id) return;
    try { await api.feedbackSuggestion(id, suggestionId, feedback); } catch (error) { console.error("[Workbench] suggestion feedback failed:", error); }
  }, [id]);

  if (ivLoading) return <PageSpinner text="正在加载面试数据..." />;
  if (interviewError) {
    const absent = interviewError.status === 404;
    return <main className="wb-error-state" role="alert"><h1>{absent ? "面试记录不存在" : "面试工作台加载失败"}</h1><p>{absent ? "该面试可能已被移除，或当前账号没有访问权限。" : "请检查服务或网络状态，然后重试。"}</p><div className="wb-error-actions">{!absent && <button type="button" className="btn btn-primary" onClick={refreshInterview}>重试</button>}<Link className="btn btn-outline" to="/">返回列表</Link></div></main>;
  }
  if (!interview) return <PageSpinner text="正在处理面试记录..." />;

  const candidateName = interview.participants?.find((p) => p.role === "candidate")?.displayName || "候选人";
  const jobTitle = interview.job?.title || "岗位待确认";

  return <div className="workbench"><div className="wb-topbar"><div className="wb-info"><Link className="wb-back" to="/">返回列表</Link><div className="wb-title-group"><div className="wb-title-line"><span className="wb-title">{candidateName}</span><Badge source="status" value={interview.status} /></div><span className="wb-subtitle">{jobTitle} / {getRoundLabel(interview.roundType)}</span></div></div><div className="wb-topbar-right"><MeetingBinder feishuMeetingId={interview.feishuMeetingId ?? null} captureStatus={captureStatus} binding={meetingBinding} onBind={handleBind} onUnbind={handleUnbind} onRestart={restartCapture} onReconcile={handleReconcile} /><div className="wb-time">{formatScheduledAt(interview.scheduledAt, interview.durationMinutes)}</div></div></div><div className="wb-body"><LeftPanel interview={interview} /><CenterPanel plan={plan} transcript={transcript} review={review} planGenerating={planGenerating} reviewGenerating={reviewGenerating} ledgerStatus={interview.ledgerStatus} ledgerTransitions={interview.ledgerTransitions} onGeneratePlan={handleGeneratePlan} onConfirmPlan={handleConfirmPlan} onGenerateReview={handleGenerateReview} onApproveReview={handleApproveReview} onUpdateReview={handleUpdateReview} onExportReview={handleExportReview} syncing={syncing} conflicts={conflicts} syncResult={syncResult} onSync={handleSync} onLoadConflicts={loadConflicts} onResolveConflicts={handleResolveConflicts} /><RightPanel liveSuggestions={suggestions} review={review} reviewGenerating={reviewGenerating} onGenerateReview={handleGenerateReview} onSuggestionFeedback={handleSuggestionFeedback} /></div></div>;
}
