import { Link } from "react-router-dom";
import { Badge } from "../../components/ui";
import { getRoundLabel } from "../../lib/mappings";
import type { InterviewSummary } from "../../lib/api";
import "./InterviewCard.css";

interface InterviewCardProps {
  interview: InterviewSummary;
}

function getCandidateName(interview: InterviewSummary) {
  return interview.participants?.find((p) => p.role === "candidate")?.displayName || "未知候选人";
}

function getInterviewers(interview: InterviewSummary) {
  return interview.participants?.filter((p) => p.role === "interviewer").map((p) => p.displayName) || [];
}

function getInitials(name: string) {
  return name.replace(/\s+/g, "").slice(0, 2) || "候选";
}

function formatSchedule(value: string) {
  const scheduled = new Date(value);
  if (Number.isNaN(scheduled.getTime())) return "时间待确认";
  return scheduled.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function InterviewCard({ interview }: InterviewCardProps) {
  const candidateName = getCandidateName(interview);
  const interviewers = getInterviewers(interview);
  const meetingLabel = interview.feishuMeetingId ? "已绑定会议" : "待绑定会议";

  return (
    <Link to={`/interview/${interview.id}`} className="interview-card">
      <div className="ic-top">
        <div className="ic-avatar" aria-hidden="true">
          {getInitials(candidateName)}
        </div>
        <div className="ic-title-group">
          <div className="ic-candidate">{candidateName}</div>
          <div className="ic-role">{getRoundLabel(interview.roundType)}</div>
        </div>
        <Badge source="status" value={interview.status} />
      </div>

      <div className="ic-body">
        <div className="ic-info-row">
          <span>面试时间</span>
          <strong>{formatSchedule(interview.scheduledAt)}</strong>
        </div>
        <div className="ic-info-row">
          <span>预计时长</span>
          <strong>{interview.durationMinutes || 0} 分钟</strong>
        </div>
        <div className="ic-info-row">
          <span>会议记录</span>
          <strong className={interview.feishuMeetingId ? "ic-ok" : "ic-warn"}>{meetingLabel}</strong>
        </div>
      </div>

      <div className="ic-footer">
        <span>{interviewers.length > 0 ? `面试官：${interviewers.join("、")}` : "面试官待确认"}</span>
        <span className="ic-enter">进入工作台 →</span>
      </div>
    </Link>
  );
}
