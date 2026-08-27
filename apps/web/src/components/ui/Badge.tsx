import { INTERVIEW_STATUS_MAP, TOPIC_STATUS_MAP, CONTENT_TYPE_MAP, DECISION_MAP, LEDGER_STATUS_MAP } from "../../lib/mappings";
import "./Badge.css";

export type BadgeSource = "status" | "topic" | "contentType" | "decision" | "ledger";

interface BadgeProps {
  source: BadgeSource;
  value: string;
  className?: string;
}

interface BadgeStyle {
  label: string;
  backgroundColor: string;
  textColor: string;
  icon?: string;
}

function getStyle(source: BadgeSource, value: string): BadgeStyle | null {
  if (source === "status") {
    const m = INTERVIEW_STATUS_MAP[value];
    return m ? { label: m.label, backgroundColor: m.color, textColor: m.textColor } : null;
  }
  if (source === "topic") {
    const m = TOPIC_STATUS_MAP[value];
    return m ? { label: m.label, backgroundColor: m.color, textColor: "var(--color-gray-700)" } : null;
  }
  if (source === "contentType") {
    const m = CONTENT_TYPE_MAP[value];
    return m ? { label: m.label, backgroundColor: m.bar, textColor: m.textColor } : null;
  }
  if (source === "decision") {
    const m = DECISION_MAP[value];
    return m ? { label: m.label, backgroundColor: m.color, textColor: m.textColor, icon: m.icon } : null;
  }
  if (source === "ledger") {
    const m = LEDGER_STATUS_MAP[value];
    return m ? { label: m.label, backgroundColor: m.color, textColor: m.textColor } : null;
  }
  return null;
}

export default function Badge({ source, value, className = "" }: BadgeProps) {
  const style = getStyle(source, value);

  if (!style) {
    return <span className={`badge badge-unknown ${className}`}>{value}</span>;
  }

  return (
    <span
      className={`badge badge-${source} ${className}`}
      style={{
        backgroundColor: style.backgroundColor,
        color: style.textColor,
      }}
    >
      {style.icon && <span className="badge-icon">{style.icon}</span>}
      <span>{style.label}</span>
    </span>
  );
}
