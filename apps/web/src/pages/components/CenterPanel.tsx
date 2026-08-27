import { useMemo, useState, useCallback, type KeyboardEvent } from "react";
import { CenterPanelPlan } from "./CenterPanelPlan";
import { CenterPanelTranscript } from "./CenterPanelTranscript";
import { CenterPanelReview } from "./CenterPanelReview";
import type { TranscriptLine, ReviewDraft, InterviewPlan, TopicStatus } from "@vice/contracts";
import type { GeneratedInterviewPlan, SyncResult, SyncConflictsResponse } from "../../lib/api";
import "./CenterPanel.css";

type Tab = "plan" | "transcript" | "review";
const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "一页纸" },
  { key: "transcript", label: "逐字稿" },
  { key: "review", label: "面评" },
];

interface CenterPanelProps {
  plan: GeneratedInterviewPlan | null;
  transcript: TranscriptLine[];
  review: ReviewDraft | null;
  planGenerating: boolean;
  reviewGenerating: boolean;
  ledgerStatus?: string;
  ledgerTransitions?: string;
  onGeneratePlan: () => void;
  onConfirmPlan: () => void;
  onGenerateReview: () => Promise<unknown>;
  onApproveReview: (decision: string) => Promise<unknown>;
  onUpdateReview: (data: Pick<ReviewDraft, "overview" | "strengths" | "risks" | "nextRoundFocus">) => Promise<unknown>;
  onExportReview: () => Promise<unknown>;
  syncing?: boolean;
  conflicts?: SyncConflictsResponse | null;
  syncResult?: SyncResult | null;
  onSync?: () => Promise<SyncResult | undefined>;
  onLoadConflicts?: () => Promise<void>;
  onResolveConflicts?: (action: "retry" | "force" | "cancel") => Promise<unknown>;
}

function calculatePlanStats(plan: InterviewPlan | null) {
  const topics = plan?.topics ?? [];
  const byStatus = (values: TopicStatus[]) => topics.filter((topic) => values.includes(topic.status)).length;
  const covered = byStatus(["covered"]);
  const needsFollowup = byStatus(["needs_followup", "evidence_partial", "started"]);
  const unasked = byStatus(["unasked"]);

  return {
    total: topics.length,
    covered,
    needsFollowup,
    unasked,
  };
}

function getPanelTitle(tab: Tab) {
  if (tab === "transcript") return "会议逐字稿";
  if (tab === "review") return "面评草稿";
  return "面试一页纸";
}

export default function CenterPanel({
  plan,
  transcript,
  review,
  planGenerating,
  reviewGenerating,
  ledgerStatus,
  ledgerTransitions,
  onGeneratePlan,
  onConfirmPlan,
  onGenerateReview,
  onApproveReview,
  onUpdateReview,
  onExportReview,
  syncing,
  conflicts,
  syncResult,
  onSync,
  onLoadConflicts,
  onResolveConflicts,
}: CenterPanelProps) {
  const [tab, setTab] = useState<Tab>("plan");
  const stats = useMemo(() => calculatePlanStats(plan), [plan]);

  const handleTabKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = TABS.findIndex((t) => t.key === tab);
    let next: number;
    if (e.key === "ArrowRight") {
      next = (idx + 1) % TABS.length;
    } else if (e.key === "ArrowLeft") {
      next = (idx - 1 + TABS.length) % TABS.length;
    } else {
      return;
    }
    e.preventDefault();
    setTab(TABS[next].key);
    document.getElementById(`cp-tab-${TABS[next].key}`)?.focus();
  }, [tab]);

  return (
    <section className="center-panel" aria-label="面试工作区">
      <div className="cp-head">
        <div>
          <h2>{getPanelTitle(tab)}</h2>
          <p>
            {tab === "plan"
              ? `已覆盖 ${stats.covered}/${stats.total || 0}  待追问 ${stats.needsFollowup}  未聊 ${stats.unasked}`
              : tab === "transcript"
                ? `${transcript.length} 条会议记录`
                : review
                  ? "草稿已生成，等待人工确认"
                  : "面试结束后生成面评草稿"}
          </p>
        </div>
        {plan?.confirmedAt ? (
          <span className="cp-confirmed">已确认</span>
        ) : (
          <span className="cp-draft">待确认</span>
        )}
      </div>

      <div className="cp-tabs" role="tablist" aria-label="面试标签页">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            aria-controls={`cp-panel-${key}`}
            id={`cp-tab-${key}`}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
            onKeyDown={handleTabKeyDown}
            tabIndex={tab === key ? 0 : -1}
          >
            {label}
            {key === "transcript" && transcript.length > 0 ? ` ${transcript.length}` : ""}
          </button>
        ))}
      </div>

      <div className="cp-content">
        <div role="tabpanel" id="cp-panel-plan" aria-labelledby="cp-tab-plan" hidden={tab !== "plan"}>
          {tab === "plan" && (
            <CenterPanelPlan
              plan={plan}
              generating={planGenerating}
              onGenerate={onGeneratePlan}
              onConfirm={onConfirmPlan}
            />
          )}
        </div>
        <div role="tabpanel" id="cp-panel-transcript" aria-labelledby="cp-tab-transcript" hidden={tab !== "transcript"}>
          {tab === "transcript" && (
            <CenterPanelTranscript transcript={transcript} />
          )}
        </div>
        <div role="tabpanel" id="cp-panel-review" aria-labelledby="cp-tab-review" hidden={tab !== "review"}>
          {tab === "review" && (
            <CenterPanelReview
              review={review}
              transcriptCount={transcript.length}
              generating={reviewGenerating}
              ledgerStatus={ledgerStatus}
              ledgerTransitions={ledgerTransitions}
              onGenerate={onGenerateReview}
              onApprove={onApproveReview}
              onUpdate={onUpdateReview}
              onExport={onExportReview}
              syncing={syncing}
              conflicts={conflicts}
              syncResult={syncResult}
              onSync={onSync}
              onLoadConflicts={onLoadConflicts}
              onResolveConflicts={onResolveConflicts}
            />
          )}
        </div>
      </div>
    </section>
  );
}
