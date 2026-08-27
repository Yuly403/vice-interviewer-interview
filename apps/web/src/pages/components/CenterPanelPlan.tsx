import TopicCard from "./TopicCard";
import type { GeneratedInterviewPlan } from "../../lib/api";
import "./CenterPanelPlan.css";

interface CenterPanelPlanProps {
  plan: GeneratedInterviewPlan | null;
  generating: boolean;
  onGenerate: () => void;
  onConfirm: () => void;
}

export function CenterPanelPlan({ plan, generating, onGenerate, onConfirm }: CenterPanelPlanProps) {
  if (generating) {
    return (
      <div className="cpp-loading">
        <div className="cpp-loading-head">
          <strong>正在生成一页纸</strong>
          <span>正在整理岗位要求和候选人材料</span>
        </div>
        <div className="cpp-skeleton cpp-skeleton-wide" />
        <div className="cpp-skeleton" />
        <div className="cpp-skeleton cpp-skeleton-short" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="cpp-empty">
        <h3>还没有面试一页纸</h3>
        <p>生成后将按主题组织开场问题、追问和判断依据。</p>
        <button className="btn btn-primary" onClick={onGenerate}>
          生成面试一页纸
        </button>
      </div>
    );
  }

  const topics = Array.isArray(plan.topics) ? plan.topics : [];
  const generationLabel = plan.generation?.mode === "llm" ? "AI 生成" : plan.generation?.mode === "rule-based" ? "规则兜底" : null;
  const generationTitle = plan.generation
    ? plan.generation.mode === "llm"
      ? `模型：${plan.generation.model ?? "未记录"}；提示词：${plan.generation.promptVersion}`
      : `模型生成未完成，已使用规则模板；原因：${plan.generation.fallbackReason ?? "unknown"}`
    : undefined;

  return (
    <div className="cpp-wrap">
      <div className="cpp-header">
        <div className="cpp-meta">
          <span>第 {plan.revision} 版</span>
          {generationLabel && (
            <span
              className={`cpp-generation cpp-generation-${plan.generation?.mode}`}
              title={generationTitle}
            >
              {generationLabel}
            </span>
          )}
        </div>
        <div className="cpp-actions">
          <button className="btn btn-secondary btn-sm" onClick={onGenerate}>
            重新生成
          </button>
          {!plan.confirmedAt ? (
            <button className="btn btn-primary btn-sm" onClick={onConfirm}>
              确认一页纸
            </button>
          ) : (
            <span className="cpp-confirmed">已确认</span>
          )}
        </div>
      </div>

      <div className="cpp-budget">
        <span>开场 {plan.openingBudgetMinutes} 分钟</span>
        <span>总时长 {plan.totalDurationMinutes} 分钟</span>
        <span>收尾 {plan.closingBudgetMinutes} 分钟</span>
      </div>

      <div className="cpp-topics">
        {topics.length > 0 ? (
          topics.map((topic, index) => (
            <TopicCard key={topic.id || index} topic={topic} index={index} />
          ))
        ) : (
          <div className="cpp-empty">
            <p>当前计划没有可显示的面试主题，请重新生成。</p>
          </div>
        )}
      </div>
    </div>
  );
}
