/**
 * CaptureStatusBar — 采集状态实时指示器 (P2-D)
 *
 * Shows capture worker real-time status inline in the top bar.
 * Compact by default, expandable on hover to show details:
 *   - Line count, cursor lag, uptime, failure count
 */

import { useState, useMemo } from "react";
import type { CaptureStatus } from "../../lib/api";
import "./CaptureStatusBar.css";

interface CaptureStatusBarProps {
  status: CaptureStatus;
  onRestart: () => void;
}

/** Format seconds into a readable string */
function formatLag(seconds: number): string {
  if (seconds < 0) return "超前";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Format a Date from ISO string, return relative string */
function formatRelative(isoStr: string | undefined): string {
  if (!isoStr) return "--";
  const diff = Date.now() - new Date(isoStr).getTime();
  const s = Math.max(0, Math.round(diff / 1000));
  return formatLag(s) + " 前";
}

export default function CaptureStatusBar({ status, onRestart }: CaptureStatusBarProps) {
  const [expanded, setExpanded] = useState(false);

  const cursorLag = useMemo(() => {
    if (!status.cursorTime) return null;
    const diff = (Date.now() - new Date(status.cursorTime).getTime()) / 1000;
    return Math.max(0, Math.round(diff));
  }, [status.cursorTime]);

  const uptime = useMemo(() => {
    if (!status.startedAt) return null;
    const diff = (Date.now() - new Date(status.startedAt).getTime()) / 1000;
    return Math.max(0, Math.round(diff));
  }, [status.startedAt]);

  // Status classification
  const phase: "live" | "lagging" | "error" = !status.running
    ? "error"
    : status.consecutiveFailures >= 3
    ? "error"
    : cursorLag !== null && cursorLag > 60
    ? "lagging"
    : "live";

  const phaseLabel = { live: "采集中", lagging: "延迟", error: "异常" }[phase];

  return (
    <div
      className={`csb-root csb-${phase}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Compact bar */}
      <div className="csb-compact">
        <span className={`csb-dot csb-dot-${phase}`} />
        <span className="csb-phase-label">{phaseLabel}</span>
        <span className="csb-linecount">{status.lineCount} 行</span>
        {cursorLag !== null && (
          <span className="csb-lag">延迟 {formatLag(cursorLag)}</span>
        )}
        <span className="csb-expand-icon">{expanded ? "▾" : "▸"}</span>
      </div>

      {/* Detail panel (on hover) */}
      {expanded && (
        <div className="csb-panel">
          <div className="csb-panel-grid">
            <div className="csb-stat">
              <span className="csb-stat-label">状态</span>
              <span className="csb-stat-value">
                {status.running ? (
                  phase === "live" ? (
                    <span className="csb-text-live">运行中</span>
                  ) : phase === "lagging" ? (
                    <span className="csb-text-warning">延迟</span>
                  ) : (
                    <span className="csb-text-error">异常</span>
                  )
                ) : (
                  <span className="csb-text-muted">已停止</span>
                )}
              </span>
            </div>
            <div className="csb-stat">
              <span className="csb-stat-label">已采集</span>
              <span className="csb-stat-value">{status.lineCount} 行</span>
            </div>
            <div className="csb-stat">
              <span className="csb-stat-label">时间延迟</span>
              <span className={`csb-stat-value ${cursorLag !== null && cursorLag > 30 ? "csb-text-warning" : ""}`}>
                {cursorLag !== null ? formatLag(cursorLag) : "--"}
              </span>
            </div>
            <div className="csb-stat">
              <span className="csb-stat-label">最后成功</span>
              <span className="csb-stat-value">{formatRelative(status.lastSuccessAt)}</span>
            </div>
            <div className="csb-stat">
              <span className="csb-stat-label">运行时长</span>
              <span className="csb-stat-value">{uptime !== null ? formatLag(uptime) : "--"}</span>
            </div>
            <div className="csb-stat">
              <span className="csb-stat-label">连续失败</span>
              <span className={`csb-stat-value ${status.consecutiveFailures > 0 ? "csb-text-error" : ""}`}>
                {status.consecutiveFailures > 0 ? `${status.consecutiveFailures} 次` : "0"}
              </span>
            </div>
          </div>

          {status.lastError && (
            <div className="csb-error-msg">
              <span className="csb-error-label">最近错误：</span>
              <span className="csb-error-text">{status.lastError}</span>
            </div>
          )}

          <div className="csb-actions">
            <button
              className="csb-action-btn csb-action-restart"
              onClick={(e) => {
                e.stopPropagation();
                onRestart();
              }}
            >
              🔄 重启采集
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
