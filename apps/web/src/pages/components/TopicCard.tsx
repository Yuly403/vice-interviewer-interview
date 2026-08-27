import { useState } from "react";
import type { Topic, Criterion, TopicStatus } from "@vice/contracts";
import "./TopicCard.css";

interface TopicCardProps {
  topic: Topic;
  index: number;
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  unasked: { label: "未聊", tone: "muted" },
  started: { label: "进行中", tone: "primary" },
  evidence_partial: { label: "证据不足", tone: "warning" },
  needs_followup: { label: "待追问", tone: "warning" },
  covered: { label: "已覆盖", tone: "success" },
  skipped_by_human: { label: "已跳过", tone: "muted" },
  not_applicable: { label: "不适用", tone: "muted" },
};

type DbFollowup = { question?: string };
type DbSignal = { type?: string; text?: string };

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeFollowups(topic: Topic): string[] {
  return asArray<string | DbFollowup>((topic as any).followups)
    .map((item) => typeof item === "string" ? item : item.question)
    .filter((item): item is string => Boolean(item));
}

function normalizeSignals(topic: Topic, type: "good" | "risk"): string[] {
  const directField = type === "good" ? (topic as any).goodSignals : (topic as any).riskSignals;
  const direct = asArray<string>(directField);
  if (direct.length > 0) return direct;

  return asArray<DbSignal>((topic as any).signals)
    .filter((signal) => signal.type === type)
    .map((signal) => signal.text)
    .filter((item): item is string => Boolean(item));
}

function CriterionItem({ criterion }: { criterion: Criterion }) {
  const icon =
    criterion.status === "supported" ? "✓" :
    criterion.status === "partial" ? "◐" :
    "○";

  return (
    <li className={`tc-criterion tc-criterion-${criterion.status}`}>
      <span className="tc-criterion-icon">{icon}</span>
      <span>{criterion.text}</span>
    </li>
  );
}

export default function TopicCard({ topic, index }: TopicCardProps) {
  const statusKey = (topic.status ?? "unasked") as TopicStatus;
  const status = STATUS_META[statusKey] ?? { label: String(statusKey), tone: "muted" };
  const isCurrent = statusKey === "started" || statusKey === "needs_followup";
  const followups = normalizeFollowups(topic);
  const goodSignals = normalizeSignals(topic, "good");
  const riskSignals = normalizeSignals(topic, "risk");
  const criteria = asArray<Criterion>((topic as any).criteria);
  const [expanded, setExpanded] = useState(isCurrent || index === 0);

  return (
    <article className={`topic-card topic-card-${status.tone} ${isCurrent ? "topic-card-current" : ""}`}>
      <button
        type="button"
        className="tc-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="tc-index">{index + 1}</div>
        <div className="tc-heading">
          <div className="tc-title-line">
            <h4>{topic.title}</h4>
            <span className={`tc-status tc-status-${status.tone}`}>{status.label}</span>
          </div>
          <p>{topic.why}</p>
        </div>
        <span className="tc-expand-label">{expanded ? "收起" : "展开"}</span>
      </button>

      {expanded && (
        <div className="tc-body">
          <div className="tc-question-block">
            <span className="tc-block-label">开场问题</span>
            <p>{topic.openingQuestion}</p>
          </div>

          {followups.length > 0 && (
            <div className="tc-followups">
              <span className="tc-block-label">追问建议</span>
              <div className="tc-followup-list">
                {followups.slice(0, 3).map((followup, followupIndex) => (
                  <p key={`${topic.id || topic.title}-followup-${followupIndex}`}>
                    {followup}
                  </p>
                ))}
              </div>
            </div>
          )}

          {(goodSignals.length > 0 || riskSignals.length > 0) && (
            <div className="tc-signals">
              {goodSignals.length > 0 && (
                <div>
                  <span className="tc-block-label">加分信号</span>
                  <ul>
                    {goodSignals.slice(0, 3).map((signal) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                </div>
              )}
              {riskSignals.length > 0 && (
                <div>
                  <span className="tc-block-label">需关注</span>
                  <ul>
                    {riskSignals.slice(0, 3).map((signal) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {criteria.length > 0 && (
            <div className="tc-criteria-box">
              <span className="tc-block-label">判断依据</span>
              <ul className="tc-criteria">
                {criteria.map((criterion, criterionIndex) => (
                  <CriterionItem key={criterion.id || criterionIndex} criterion={criterion} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
