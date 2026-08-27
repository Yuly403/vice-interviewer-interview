import type { ReactNode } from "react";
import "./EmptyState.css";

export type EmptyScene = "interviews" | "plan" | "transcript" | "review" | "generic";

const SCENE_CONFIG: Record<EmptyScene, { icon: string; title: string; hint: string }> = {
  interviews: { icon: "", title: "暂无面试记录", hint: "点击「导入面试包」开始" },
  plan: { icon: "", title: "暂无面试计划", hint: "确认候选人岗位信息后生成面试计划" },
  transcript: { icon: "", title: "暂无逐字稿", hint: "面试开始后逐字稿会实时显示在这里" },
  review: { icon: "", title: "暂无面评草稿", hint: "面试逐字稿就绪后可生成面评" },
  generic: { icon: "", title: "暂无数据", hint: "" },
};

interface EmptyStateProps {
  scene?: EmptyScene;
  icon?: string;
  title?: string;
  hint?: string;
  action?: ReactNode;
}

export default function EmptyState({ scene = "generic", icon, title, hint, action }: EmptyStateProps) {
  const cfg = SCENE_CONFIG[scene];
  const displayIcon = icon ?? cfg.icon;
  const displayTitle = title ?? cfg.title;
  const displayHint = hint ?? cfg.hint;

  return (
    <div className="empty-state">
      <div className="empty-state-icon">{displayIcon}</div>
      <p className="empty-state-title">{displayTitle}</p>
      {displayHint && <p className="empty-state-hint">{displayHint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
