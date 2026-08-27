import React, { useRef, useEffect, useState, useMemo } from "react";
import { EmptyState } from "../../components/ui";
import type { TranscriptLine } from "@vice/contracts";
import "./CenterPanelTranscript.css";

interface CenterPanelTranscriptProps {
  transcript: TranscriptLine[];
}

const PAGE_SIZE = 50;

export function CenterPanelTranscript({ transcript }: CenterPanelTranscriptProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Lowest index that counts as "new" (not loaded via "load earlier").
  // Starts at transcript.length - PAGE_SIZE on mount.
  const newestSinceRef = useRef(0);

  // Initialize newestSinceRef once
  useEffect(() => {
    if (transcript.length > 0 && newestSinceRef.current === 0) {
      newestSinceRef.current = Math.max(0, transcript.length - PAGE_SIZE);
    }
  }, [transcript.length]);

  // Auto-scroll to bottom when new lines arrive (only if already near bottom)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript.length]);

  // Reset visibleCount when transcript grows
  useEffect(() => {
    setVisibleCount((prev) => Math.max(PAGE_SIZE, prev));
  }, [transcript.length]);

  const hasMore = transcript.length > visibleCount;
  const visible = useMemo(
    () => transcript.slice(Math.max(0, transcript.length - visibleCount)),
    [transcript, visibleCount],
  );

  // Items with index in transcript >= newestSinceRef are "new" items.
  // In the visible slice, the first "new" item index is:
  const visibleNewestSplitIdx = useMemo(() => {
    const globalNewestStart = newestSinceRef.current;
    const visibleGlobalStart = Math.max(0, transcript.length - visibleCount);
    if (globalNewestStart <= visibleGlobalStart) return 0;
    return globalNewestStart - visibleGlobalStart;
  }, [transcript.length, visibleCount]);

  const loadMore = () => {
    setVisibleCount((prev) => Math.min(transcript.length, prev + PAGE_SIZE));
  };

  if (transcript.length === 0) {
    return <EmptyState scene="transcript" />;
  }

  return (
    <div className="transcript-list" ref={listRef}>
      {/* Load earlier button */}
      {hasMore && (
        <div className="tl-load-more">
          <button className="btn btn-ghost btn-sm" onClick={loadMore}>
            加载更早记录 ({transcript.length - visibleCount} 条)
          </button>
        </div>
      )}

      {visible.map((line, idx) => {
        const lineItems: React.ReactNode[] = [];
        // Insert "最新" marker at the boundary between old and new items
        if (idx === visibleNewestSplitIdx && transcript.length > 10 && idx > 0) {
          lineItems.push(
            <div key="tl-recent-marker" className="tl-recent-marker">
              <span className="tl-recent-line" />
              <span className="tl-recent-label">最新</span>
              <span className="tl-recent-line" />
            </div>,
          );
        }
        lineItems.push(
          <div key={line.id} className={`transcript-line tl-role-${line.speakerRole}`}>
            <div className="tl-meta">
              <span className="tl-speaker">{line.speakerDisplayName}</span>
              <span className="tl-role-label">
                {line.speakerRole === "candidate"
                  ? "候选人"
                  : line.speakerRole === "interviewer"
                    ? "面试官"
                    : ""}
              </span>
              <span className="tl-time">
                {new Date(line.occurredAt).toLocaleTimeString("zh-CN")}
              </span>
            </div>
            <div className="tl-text">{line.text}</div>
          </div>,
        );
        return <div key={`wrapper-${line.id || idx}`}>{lineItems}</div>;
      })}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
