import { useState, useMemo, useCallback, useEffect } from "react";
import { EmptyState, Spinner, Badge, Modal } from "../../components/ui";
import { DECISION_MAP, CONTENT_TYPE_MAP, formatLedgerTransition } from "../../lib/mappings";
import type { ReviewDraft } from "@vice/contracts";
import SyncPanel from "./SyncPanel";
import type { SyncResult, SyncConflictsResponse } from "../../lib/api";
import "./CenterPanelReview.css";

interface CenterPanelReviewProps {
  review: ReviewDraft | null;
  transcriptCount: number;
  generating: boolean;
  ledgerStatus?: string;
  ledgerTransitions?: string;
  onGenerate: () => Promise<unknown>;
  onApprove: (decision: string) => Promise<unknown>;
  onUpdate: (data: Pick<ReviewDraft, "overview" | "strengths" | "risks" | "nextRoundFocus">) => Promise<unknown>;
  onExport: () => Promise<unknown>;
  syncing?: boolean;
  conflicts?: SyncConflictsResponse | null;
  syncResult?: SyncResult | null;
  onSync?: () => Promise<SyncResult | undefined>;
  onLoadConflicts?: () => Promise<void>;
  onResolveConflicts?: (action: "retry" | "force" | "cancel") => Promise<unknown>;
}

function linesToArray(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function formatReviewForClipboard(review: ReviewDraft): string {
  const lines = [`面试面评（第 ${review.revision} 版）`, ""];
  if (review.overview) lines.push("综合评价", review.overview, "");
  review.conclusions?.forEach((conclusion) => {
    lines.push(`${CONTENT_TYPE_MAP[conclusion.contentType]?.label || conclusion.contentType} · ${conclusion.dimension}`, conclusion.text);
    conclusion.evidenceRefs?.forEach((evidence) => lines.push(`证据：${evidence.quote}`));
    lines.push("");
  });
  if (review.strengths?.length) lines.push("亮点", ...review.strengths.map((item) => `- ${item}`), "");
  if (review.risks?.length) lines.push("风险", ...review.risks.map((item) => `- ${item}`), "");
  if (review.humanDecision) lines.push(`面试结论：${DECISION_MAP[review.humanDecision]?.label || review.humanDecision}`);
  return lines.join("\n");
}

export function CenterPanelReview(props: CenterPanelReviewProps) {
  const { review, transcriptCount, generating, ledgerStatus, ledgerTransitions, onGenerate, onApprove, onUpdate, onExport, syncing = false, conflicts = null, syncResult = null, onSync, onLoadConflicts, onResolveConflicts } = props;
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approvingDecision, setApprovingDecision] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overview, setOverview] = useState("");
  const [strengths, setStrengths] = useState("");
  const [risks, setRisks] = useState("");
  const [nextRoundFocus, setNextRoundFocus] = useState("");

  useEffect(() => {
    if (!review) return;
    setOverview(review.overview || "");
    setStrengths((review.strengths || []).join("\n"));
    setRisks((review.risks || []).join("\n"));
    setNextRoundFocus((review.nextRoundFocus || []).join("\n"));
  }, [review]);

  const ledgerEntries = useMemo(() => {
    if (!ledgerTransitions) return [];
    try { return JSON.parse(ledgerTransitions) as Array<{ from: string | null; to: string; source: "auto" | "manual"; reason: string; timestamp: string; }>; }
    catch { return []; }
  }, [ledgerTransitions]);

  const handleApproveClick = useCallback(async (decision: string) => {
    setApprovingDecision(decision);
    try { await onApprove(decision); setShowApproveModal(false); }
    catch { /* Workbench presents a user-safe error. */ }
    finally { setApprovingDecision(null); }
  }, [onApprove]);

  const handleCopy = useCallback(async () => {
    if (!review) return;
    const text = formatReviewForClipboard(review);
    try { await navigator.clipboard.writeText(text); }
    catch {
      const textarea = document.createElement("textarea");
      textarea.value = text; textarea.style.position = "fixed"; textarea.style.opacity = "0";
      document.body.appendChild(textarea); textarea.select(); document.execCommand("copy"); document.body.removeChild(textarea);
    }
    setCopied(true); window.setTimeout(() => setCopied(false), 2_000);
  }, [review]);

  const handleExportText = useCallback(() => {
    if (!review) return;
    const url = URL.createObjectURL(new Blob([formatReviewForClipboard(review)], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `Review-${review.interviewId}-r${review.revision}.txt`; link.click(); URL.revokeObjectURL(url);
  }, [review]);

  const handleSave = useCallback(async () => {
    if (!overview.trim()) return;
    setSaving(true);
    try {
      await onUpdate({ overview: overview.trim(), strengths: linesToArray(strengths), risks: linesToArray(risks), nextRoundFocus: linesToArray(nextRoundFocus) });
      setEditing(false);
    } catch { /* Workbench presents a user-safe error. */ }
    finally { setSaving(false); }
  }, [overview, strengths, risks, nextRoundFocus, onUpdate]);

  if (generating) return <Spinner text="正在生成面评草稿..." />;
  if (!review) return <EmptyState scene="review" action={transcriptCount > 0 ? <button type="button" className="btn btn-primary" onClick={() => void onGenerate()}>生成面评草稿</button> : undefined} />;

  return <div className="review-panel">
    <div className="rp-header"><span className="rp-revision">面评 · 第 {review.revision} 版</span><div className="rp-actions">{ledgerStatus && <Badge source="ledger" value={ledgerStatus} className="rp-ledger-badge" />}{review.approvedAt ? <div className="rp-approved"><Badge source="decision" value={review.humanDecision || "hold"} /><span className="rp-approved-at">{new Date(review.approvedAt).toLocaleString("zh-CN")}</span></div> : <><button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing((value) => !value)}>{editing ? "取消编辑" : "编辑面评"}</button><button type="button" className="btn btn-primary btn-sm" onClick={() => setShowApproveModal(true)}>确认面评</button></>}</div></div>

    {editing ? <section className="rp-edit-form" aria-label="编辑面评草稿"><label>综合评价<textarea value={overview} onChange={(event) => setOverview(event.target.value)} rows={4} maxLength={8000} /></label><div className="rp-edit-grid"><label>亮点（每行一项）<textarea value={strengths} onChange={(event) => setStrengths(event.target.value)} rows={4} /></label><label>风险（每行一项）<textarea value={risks} onChange={(event) => setRisks(event.target.value)} rows={4} /></label></div><label>下轮建议（每行一项）<textarea value={nextRoundFocus} onChange={(event) => setNextRoundFocus(event.target.value)} rows={3} /></label><div className="rp-edit-actions"><button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>取消</button><button type="button" className="btn btn-primary" disabled={!overview.trim() || saving} onClick={() => void handleSave()}>{saving ? "保存中..." : "保存新版本"}</button></div></section> : <>
      {review.overview && <div className="rp-overview">{review.overview}</div>}
      <div className="rp-evidence-summary" aria-label="面评证据摘要"><strong>{review.conclusions?.length || 0}</strong><span>条结论</span><strong>{review.conclusions?.reduce((count, item) => count + (item.evidenceRefs?.length || 0), 0) || 0}</strong><span>处原话证据</span><small>仅展示可追溯的事实与判断，不将证据数量换算为能力分数。</small></div>
      <div className="rp-conclusions">{review.conclusions?.map((conclusion, index) => <article key={conclusion.id || index} className={`rp-conclusion rp-conclusion-${conclusion.contentType}`}><div className="rpc-header"><span className="rpc-dim">{conclusion.dimension}</span><Badge source="contentType" value={conclusion.contentType} /></div><div className="rpc-text">{conclusion.text}</div>{conclusion.evidenceRefs?.length ? <div className="rpc-evidence"><span className="rpc-evidence-label">证据引用（{conclusion.evidenceRefs.length}）</span>{conclusion.evidenceRefs.map((evidence, evidenceIndex) => <blockquote key={evidenceIndex} className="rpc-quote">“{evidence.quote}”</blockquote>)}</div> : null}</article>)}</div>
      <div className="rp-summary">{review.strengths?.length ? <div className="rp-section"><strong>亮点</strong><ul>{review.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}{review.risks?.length ? <div className="rp-section"><strong>风险</strong><ul>{review.risks.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}</div>
    </>}
    <div className="rp-export-actions">{review.approvedAt && <button type="button" className="btn btn-outline" onClick={() => void onExport()}>导出结果包</button>}<button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleCopy()}>{copied ? "已复制" : "复制结果"}</button><button type="button" className="btn btn-ghost btn-sm" onClick={handleExportText}>导出纯文本</button></div>
    {ledgerEntries.length ? <section className="rp-ledger-timeline"><h4 className="rp-ledger-timeline-title">台账流转记录</h4><div className="rp-ledger-entries">{ledgerEntries.map((entry, index) => <div key={index} className="rp-ledger-entry"><div className="rp-ledger-entry-dot" /><div className="rp-ledger-entry-content"><span className="rp-ledger-entry-text">{formatLedgerTransition(entry)}</span><span className="rp-ledger-entry-time">{new Date(entry.timestamp).toLocaleString("zh-CN")}</span></div></div>)}</div></section> : null}
    {onSync ? <SyncPanel reviewApproved={!!review.approvedAt} reviewStatus={(review as ReviewDraft & { reviewStatus?: string }).reviewStatus} syncing={syncing} conflicts={conflicts} syncResult={syncResult} onSync={onSync} onLoadConflicts={onLoadConflicts!} onResolveConflicts={onResolveConflicts!} /> : null}
    <Modal open={showApproveModal} title="确认面评结论" onClose={() => setShowApproveModal(false)} actions={[{ label: "取消", variant: "ghost", onClick: () => setShowApproveModal(false) }]}><p style={{ marginBottom: "var(--space-16)" }}>确认后将写入审批记录并锁定本版面评。请选择最终结论。</p><div className="rp-approve-options">{(["pass", "hold", "reject"] as const).map((decision) => { const item = DECISION_MAP[decision]; return <button type="button" key={decision} className="rp-approve-option" onClick={() => void handleApproveClick(decision)} disabled={!!approvingDecision}><span className="rp-approve-icon">{item.icon}</span><span className="rp-approve-label">{item.label}</span></button>; })}</div></Modal>
  </div>;
}
