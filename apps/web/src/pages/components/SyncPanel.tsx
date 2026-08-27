import { useState, useCallback, useEffect } from "react";
import { Spinner, Badge } from "../../components/ui";
import type {
  SyncResult,
  SyncConflictsResponse,
  SyncConflictDetail,
  SyncAction,
} from "../../lib/api";
import "./SyncPanel.css";

interface SyncPanelProps {
  reviewApproved: boolean;
  reviewStatus?: string;
  syncing: boolean;
  conflicts: SyncConflictsResponse | null;
  syncResult: SyncResult | null;
  onSync: () => Promise<SyncResult | undefined>;
  onLoadConflicts: () => Promise<void>;
  onResolveConflicts: (action: "retry" | "force" | "cancel") => Promise<unknown>;
}

/** 冲突类型标签映射 */
const CONFLICT_TYPE_LABELS: Record<string, string> = {
  stale_line: "证据失效",
  decision_mismatch: "结论冲突",
  missing_field: "字段缺失",
};

/** 动作优先级标签 */
const PRIORITY_LABELS: Record<string, string> = {
  critical: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

function ConflictItem({ conflict }: { conflict: SyncConflictDetail }) {
  const [expanded, setExpanded] = useState(false);
  const typeLabel = CONFLICT_TYPE_LABELS[conflict.type] || conflict.type;

  return (
    <div className="sp-conflict-item">
      <div
        className="sp-conflict-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded(!expanded)}
      >
        <span className={`sp-conflict-type sp-conflict-type-${conflict.type}`}>
          {typeLabel}
        </span>
        <span className="sp-conflict-field">{conflict.fieldPath}</span>
        <span className="sp-conflict-toggle">{expanded ? "\u25B2" : "\u25BC"}</span>
      </div>
      {expanded && (
        <div className="sp-conflict-detail">
          <p className="sp-conflict-msg">{conflict.message}</p>
          <div className="sp-conflict-values">
            <div className="sp-conflict-value">
              <span className="sp-conflict-value-label">当前值</span>
              <code>{String(conflict.localValue ?? "-")}</code>
            </div>
            <div className="sp-conflict-value">
              <span className="sp-conflict-value-label">工作区值</span>
              <code>{String(conflict.remoteValue ?? "-")}</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionItem({ action }: { action: SyncAction }) {
  return (
    <div className={`sp-action-item sp-action-priority-${action.priority}`}>
      <div className="sp-action-header">
        <span className="sp-action-type">{action.title}</span>
        <span className={`sp-action-priority sp-action-priority-${action.priority}`}>
          {PRIORITY_LABELS[action.priority] || action.priority}
        </span>
        {action.autoTriggerable && (
          <span className="sp-action-auto">自动</span>
        )}
      </div>
      <p className="sp-action-desc">{action.description}</p>
      {(action.dependsOn?.length ?? 0) > 0 && (
        <div className="sp-action-deps">
          依赖: {action.dependsOn?.join(", ")}
        </div>
      )}
    </div>
  );
}

export default function SyncPanel({
  reviewApproved,
  reviewStatus,
  syncing,
  conflicts,
  syncResult,
  onSync,
  onLoadConflicts,
  onResolveConflicts,
}: SyncPanelProps) {
  const [showFollowup, setShowFollowup] = useState(false);

  // Load conflicts when review is in sync_conflict state
  useEffect(() => {
    if (reviewStatus === "sync_conflict") {
      onLoadConflicts();
    }
  }, [reviewStatus, onLoadConflicts]);

  const handleSync = useCallback(async () => {
    const result = await onSync();
    if (result?.status === "synced") {
      setShowFollowup(true);
    }
  }, [onSync]);

  const handleResolve = useCallback(
    async (action: "retry" | "force" | "cancel") => {
      await onResolveConflicts(action);
    },
    [onResolveConflicts],
  );

  // Show conflict resolution panel
  if (conflicts?.hasConflicts || reviewStatus === "sync_conflict") {
    return (
      <div className="sync-panel sync-panel-conflicts">
        <div className="sp-section-title">
          <span className="sp-section-icon">\u26A0</span>
          同步冲突
          {conflicts && (
            <span className="sp-conflict-count">
              {conflicts.count} 个冲突
            </span>
          )}
        </div>

        {syncing ? (
          <Spinner text="处理中..." />
        ) : (
          <>
            <p className="sp-conflict-desc">
              检测到同步冲突，请选择处理方式：
            </p>

            {conflicts?.conflicts && conflicts.conflicts.length > 0 && (
              <div className="sp-conflicts-list">
                {conflicts.conflicts.map((c, i) => (
                  <ConflictItem key={i} conflict={c} />
                ))}
              </div>
            )}

            <div className="sp-resolve-actions">
              <button
                className="btn btn-warning btn-sm"
                onClick={() => handleResolve("retry")}
                disabled={syncing}
              >
                确认处理，重试同步
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => handleResolve("force")}
                disabled={syncing}
              >
                强制同步（跳过检测）
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => handleResolve("cancel")}
                disabled={syncing}
              >
                取消同步
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Show followup actions after successful sync
  if (syncResult?.status === "synced" && showFollowup) {
    const followupActions = syncResult.followupActions || [];
    return (
      <div className="sync-panel sync-panel-done">
        <div className="sp-section-title">
          <span className="sp-section-icon">{"\u2705"}</span>
          同步完成
        </div>

        {/* Ledger status */}
        {syncResult.ledgerStatus && syncResult.ledgerLabel && (
          <div className="sp-ledger-info">
            <span className="sp-ledger-label">台账状态：</span>
            <Badge source="ledger" value={syncResult.ledgerStatus} />
            {!syncResult.ledgerAutoEffective && (
              <span className="sp-ledger-hint">（需手动确认）</span>
            )}
          </div>
        )}

        {/* Followup actions */}
        {followupActions.length > 0 && (
          <div className="sp-followup">
            <div className="sp-followup-header">
              <span className="sp-section-icon">{"\u{1F4CB}"}</span>
              后续动作建议
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => setShowFollowup(false)}
              >
                收起
              </button>
            </div>
            {syncResult.followupSummary && (
              <p className="sp-followup-summary">{syncResult.followupSummary}</p>
            )}
            <div className="sp-actions-list">
              {followupActions.map((a, i) => (
                <ActionItem key={i} action={a} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Sync button when review is approved
  if (!reviewApproved) return null;

  return (
    <div className="sync-panel">
      <div className="sp-section-title">
        <span className="sp-section-icon">{"\u{1F4E4}"}</span>
        同步到候选人档案
      </div>
      <p className="sp-desc">
        将已审批面评回写到工作区 <code>03-interview/</code> 目录。
        同步后自动计算台账状态并生成后续动作建议。
      </p>
      <button
        className="btn btn-primary"
        onClick={handleSync}
        disabled={syncing}
      >
        {syncing ? "同步中..." : "执行同步"}
      </button>
    </div>
  );
}
