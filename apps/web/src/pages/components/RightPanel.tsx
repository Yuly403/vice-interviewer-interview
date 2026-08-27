import { useMemo, useState } from "react";
import type { LiveSuggestion, ReviewDraft } from "@vice/contracts";
import "./RightPanel.css";

interface RightPanelProps {
  liveSuggestions: LiveSuggestion[];
  review?: ReviewDraft | null;
  reviewGenerating?: boolean;
  onGenerateReview?: () => Promise<unknown>;
  onSuggestionFeedback?: (id: string, feedback: string) => void;
}

const KIND_LABELS: Record<string, { label: string; color: string }> = {
  followup_question: { label: "追问建议", color: "primary" },
  topic_uncovered: { label: "未覆盖", color: "warning" },
  missing_evidence: { label: "证据不足", color: "warning" },
  clarify_scope: { label: "范围待澄清", color: "primary" },
  clarify_metric: { label: "指标待澄清", color: "primary" },
  time_check: { label: "节奏提醒", color: "default" },
};

function asArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }

export default function RightPanel({ liveSuggestions, review, reviewGenerating = false, onGenerateReview, onSuggestionFeedback }: RightPanelProps) {
  const [tab, setTab] = useState<"assist" | "review">("assist");
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, string>>({});
  const active = useMemo(() => asArray<LiveSuggestion>(liveSuggestions).filter((item) => new Date(item.expiresAt).getTime() > Date.now()).sort((a, b) => b.confidence - a.confidence || b.generation - a.generation), [liveSuggestions]);
  const conclusions = asArray<any>(review?.conclusions);
  const evidenceCount = conclusions.reduce((count, item) => count + asArray(item?.evidenceRefs).length, 0);

  const handleFeedback = (id: string, feedback: string) => {
    setFeedbackGiven((previous) => ({ ...previous, [id]: feedback }));
    onSuggestionFeedback?.(id, feedback);
  };

  return <aside className="right-panel" aria-label="面试辅助面板">
    <div className="rp-tabs"><button type="button" className={`rp-tab ${tab === "assist" ? "active" : ""}`} onClick={() => setTab("assist")}>面试提示</button><button type="button" className={`rp-tab ${tab === "review" ? "active" : ""}`} onClick={() => setTab("review")}>面评摘要</button></div>
    {tab === "assist" ? <div className="rp-pane"><div className="rp-section-head"><div><h3>实时面试提示</h3><p>基于逐字稿和计划生成，仅供面试官判断。</p></div></div>{active.length ? <div className="rp-live-card"><div className="rp-live-title">{active.length} 条待处理提醒</div><div className="rp-suggestion-list">{active.slice(0, 4).map((suggestion) => { const kind = KIND_LABELS[suggestion.kind] || { label: suggestion.kind, color: "default" }; const stableId = suggestion.id || `${suggestion.generation}-${suggestion.observation.slice(0, 20)}`; const feedback = feedbackGiven[stableId]; return <article key={stableId} className={`rp-suggestion-card rp-suggestion-${kind.color}`}><div className="rp-suggestion-header"><span className={`rp-suggestion-tag rp-tag-${kind.color}`}>{kind.label}</span><span className="rp-confidence">{Math.round(suggestion.confidence * 100)}%</span></div><p>{suggestion.observation}</p>{suggestion.suggestedQuestion ? <div className="rp-question">建议追问：{suggestion.suggestedQuestion}</div> : null}{!feedback ? <div className="rp-feedback-row"><button type="button" onClick={() => handleFeedback(stableId, "useful")}>有帮助</button><button type="button" onClick={() => handleFeedback(stableId, "already_asked")}>已问过</button><button type="button" onClick={() => handleFeedback(stableId, "useless")}>忽略</button></div> : <div className="rp-feedback-done">已记录反馈</div>}</article>; })}</div></div> : <div className="rp-assist-empty"><strong>暂时没有新的提醒</strong><p>面试开始并接入逐字稿后，系统会在发现未覆盖话题、证据不足或可追问点时提示你。</p></div>}<div className="rp-guidance"><h4>面试官检查清单</h4><ul><li>追问候选人的具体动作、结果和复盘</li><li>区分候选人原话、系统推断和待验证问题</li><li>最终结论由面试官确认，不由系统自动决定</li></ul></div></div> : <div className="rp-pane"><div className="rp-section-head"><div><h3>面评草稿</h3><p>编辑和确认请在中间工作区完成。</p></div><button type="button" className="rp-link-button" disabled={reviewGenerating} onClick={() => void onGenerateReview?.()}>{reviewGenerating ? "生成中..." : review ? "重新生成" : "生成草稿"}</button></div>{review ? <><div className="rp-review-summary"><div><span>草稿版本</span><strong>v{review.revision}</strong></div><div><span>原话证据</span><strong>{evidenceCount}</strong></div></div><section className="rp-review-card"><h4>综合评价</h4><p>{review.overview || "暂无综合评价。"}</p></section><section className="rp-review-card"><h4>待关注风险</h4><ul>{(review.risks?.length ? review.risks : ["暂无明确风险点。"]).map((item) => <li key={item}>{item}</li>)}</ul></section></> : <div className="rp-review-empty"><h4>还没有面评草稿</h4><p>面试结束并形成逐字稿后，可生成带原话证据的面评草稿。</p><button type="button" disabled={reviewGenerating} onClick={() => void onGenerateReview?.()}>{reviewGenerating ? "正在生成..." : "生成面评草稿"}</button></div>}</div>}
  </aside>;
}
