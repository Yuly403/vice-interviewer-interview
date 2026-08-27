import { useMemo, useState } from "react";
import { Badge, PageSpinner } from "../components/ui";
import { useInterviews } from "../hooks";
import type { InterviewSummary } from "../lib/api";
import InterviewCard from "./components/InterviewCard";
import NewInterviewModal from "./components/NewInterviewModal";
import "./InterviewList.css";

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "created", label: "待准备" },
  { value: "package_imported", label: "材料已导入" },
  { value: "ready", label: "待面试" },
  { value: "bound", label: "已绑定会议" },
  { value: "live", label: "面试中" },
  { value: "review_draft", label: "待确认面评" },
  { value: "closed", label: "已归档" },
  { value: "attention_required", label: "需关注" },
];

function getCandidateName(interview: InterviewSummary) {
  return interview.participants?.find((p) => p.role === "candidate")?.displayName || "未知候选人";
}

function isToday(dateText: string) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function needsReview(status: string) {
  return ["ended", "transcript_finalizing", "review_generating", "review_draft", "review_approved"].includes(status);
}

function isOpenInterview(status: string) {
  return !["closed", "cancelled"].includes(status);
}

export default function InterviewList() {
  const { interviews, loading, error, refresh } = useInterviews();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [showNewInterview, setShowNewInterview] = useState(false);

  const stats = useMemo(() => {
    return {
      today: interviews.filter((iv) => isToday(iv.scheduledAt)).length,
      needBinding: interviews.filter((iv) => !iv.feishuMeetingId && isOpenInterview(iv.status)).length,
      needReview: interviews.filter((iv) => needsReview(iv.status)).length,
      attention: interviews.filter((iv) => iv.status === "attention_required" || iv.status === "capture_failed").length,
    };
  }, [interviews]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return interviews.filter((iv) => {
      const matchFilter = filter === "all" || iv.status === filter;
      const candidateName = getCandidateName(iv).toLowerCase();
      const interviewers = iv.participants
        ?.filter((p) => p.role === "interviewer")
        .map((p) => p.displayName)
        .join(" ")
        .toLowerCase();
      const matchQuery =
        !q ||
        candidateName.includes(q) ||
        iv.roundType.toLowerCase().includes(q) ||
        interviewers?.includes(q);
      return matchFilter && matchQuery;
    });
  }, [interviews, query, filter]);

  if (loading) return <PageSpinner text="正在加载面试工作台..." />;

  return (
    <div className="interview-home">
      <section className="ih-page-head" aria-label="面试安排">
        <div>
          <h1>面试安排</h1>
          <p>查看待办、会议状态和面评进度。</p>
        </div>
        <div className="ih-head-actions">
          <button className="btn btn-primary" type="button" onClick={() => setShowNewInterview(true)}>新建面试</button>
          <button className="btn btn-ghost" type="button" onClick={refresh}>刷新</button>
        </div>
      </section>

      {error && (
        <div className="ih-error" role="alert">
          <div>
            <strong>面试列表加载未完成</strong>
            <span>{error.message || "请检查服务状态后重试。"}</span>
          </div>
          <button className="btn btn-outline btn-sm" type="button" onClick={refresh}>
            重试
          </button>
        </div>
      )}

      <section className="ih-stats" aria-label="面试状态概览">
        <div className="ih-stat-card">
          <span>今日面试</span>
          <strong>{stats.today}</strong>
          <small>今天需要关注的面试安排</small>
        </div>
        <div className="ih-stat-card">
          <span>待绑定会议</span>
          <strong>{stats.needBinding}</strong>
          <small>需要接入飞书会议或逐字稿</small>
        </div>
        <div className="ih-stat-card">
          <span>待生成面评</span>
          <strong>{stats.needReview}</strong>
          <small>面试后等待整理或确认</small>
        </div>
        <div className="ih-stat-card ih-stat-warning">
          <span>需关注候选人</span>
          <strong>{stats.attention}</strong>
          <small>存在风险、冲突或流程异常</small>
        </div>
      </section>

      <section className="ih-main">
        <div className="ih-section-head">
          <div>
            <h2>面试列表</h2>
            <p>按状态跟踪候选人材料准备、会议接入、面评生成和归档进度。</p>
          </div>
          <div className="ih-toolbar">
            <input
              className="ih-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索候选人、面试官或轮次"
              aria-label="搜索面试"
            />
            <div className="ih-filter" role="group" aria-label="状态筛选">
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={filter === opt.value ? "active" : ""}
                  onClick={() => setFilter(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {interviews.length === 0 ? (
          <div className="ih-empty">
            <div className="ih-empty-card">
              <span className="ih-empty-icon" aria-hidden="true">新</span>
              <h3>还没有面试记录</h3>
              <p>新建面试并录入 JD、简历和筛选结论，即可生成本场面试一页纸。</p>
              <div className="ih-empty-actions">
                <button className="btn btn-primary" type="button" onClick={() => setShowNewInterview(true)}>新建面试</button>
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="ih-no-results">
            <Badge source="status" value="attention_required" />
            <span>当前筛选条件下没有面试记录。可以清空搜索或切换状态。</span>
          </div>
        ) : (
          <div className="interview-list">
            {filtered.map((iv) => (
              <InterviewCard key={iv.id} interview={iv} />
            ))}
          </div>
        )}
      </section>
      <NewInterviewModal open={showNewInterview} onClose={() => setShowNewInterview(false)} />
    </div>
  );
}
