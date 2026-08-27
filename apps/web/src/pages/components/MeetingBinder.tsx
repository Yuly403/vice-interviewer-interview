import { useState, useEffect } from "react";
import { api, type CaptureStatus, type MeetingSearchItem } from "../../lib/api";
import { Modal } from "../../components/ui";
import CaptureStatusBar from "./CaptureStatusBar";
import "./MeetingBinder.css";

interface MeetingBinderProps {
  feishuMeetingId: string | null;
  captureStatus: CaptureStatus | null;
  binding: boolean;
  onBind: (meetingId: string) => Promise<boolean>;
  onUnbind: () => Promise<void>;
  onRestart: () => void;
  onReconcile: () => void;
}

export default function MeetingBinder({ feishuMeetingId, captureStatus, binding, onBind, onUnbind, onRestart, onReconcile }: MeetingBinderProps) {
  const [showSearch, setShowSearch] = useState(false);
  if (!feishuMeetingId) return <div className="meeting-binder"><button type="button" className="mb-btn mb-btn-bind" disabled={binding} onClick={() => setShowSearch(true)}>{binding ? "绑定中..." : "绑定会议"}</button>{showSearch ? <MeetingSearchModal onClose={() => setShowSearch(false)} onBind={onBind} /> : null}</div>;
  return <div className="meeting-binder mb-bound">{captureStatus?.running ? <CaptureStatusBar status={captureStatus} onRestart={onRestart} /> : <div className="mb-status-group"><span className={`mb-dot ${captureStatus?.consecutiveFailures ? "mb-dot-error" : "mb-dot-idle"}`} /><span className="mb-meeting-id">会议 #{feishuMeetingId.slice(-6)}</span><span className="mb-tag mb-tag-default">已绑定</span></div>}<div className="mb-actions">{!captureStatus?.running ? <button type="button" className="mb-btn mb-btn-sm" onClick={onRestart}>启动</button> : null}<button type="button" className="mb-btn mb-btn-sm" onClick={onReconcile}>补拉</button><button type="button" className="mb-btn mb-btn-sm mb-btn-danger" onClick={() => void onUnbind()}>解绑</button></div></div>;
}

function MeetingSearchModal({ onClose, onBind }: { onClose: () => void; onBind: (meetingId: string) => Promise<boolean> }) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<MeetingSearchItem[]>([]);
  const [query, setQuery] = useState("");
  const [manualId, setManualId] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const doSearch = async () => {
    setLoading(true); setSearchError(null);
    try {
      const now = new Date();
      const end = now.toISOString().slice(0, 10);
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);
      const response = await api.searchMeetings({ start, end, query: query || undefined, pageSize: 10 });
      setResults(response.data.items || []); setSearched(true);
    } catch (error) { setSearchError((error as Error).message || "搜索失败，请检查飞书连接"); setResults([]); setSearched(true); }
    finally { setLoading(false); }
  };
  const bind = async (meetingId: string) => {
    setSubmitting(true);
    try { if (await onBind(meetingId)) onClose(); }
    finally { setSubmitting(false); }
  };
  useEffect(() => { void doSearch(); }, []);
  return <Modal open title="绑定飞书会议" onClose={onClose} size="lg"><div className="mb-search"><div className="mb-search-bar"><input type="text" placeholder="搜索会议标题（可选）" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void doSearch()} className="mb-search-input" /><button type="button" className="mb-btn" onClick={() => void doSearch()} disabled={loading || submitting}>{loading ? "搜索中..." : "搜索"}</button></div><div className="mb-search-results">{loading ? <div className="mb-loading">搜索中...</div> : null}{searchError ? <div className="mb-error-banner">{searchError}</div> : null}{!loading && !searchError && searched && !results.length ? <div className="mb-empty">未找到会议</div> : null}{!loading && results.map((meeting) => <button type="button" key={meeting.id} className="mb-meeting-item" disabled={submitting} onClick={() => void bind(meeting.id)}><span className="mb-meeting-title">{meeting.display_info.split("\n")[0] || `会议 ${meeting.id}`}</span><span className="mb-meeting-meta">{meeting.meta_data.description?.split("|")[0]?.trim() || meeting.id}</span></button>)}</div><div className="mb-manual"><div className="mb-manual-label">或手动输入会议 ID（纯数字）</div><div className="mb-manual-row"><input type="text" placeholder="输入会议 ID" value={manualId} onChange={(event) => setManualId(event.target.value)} className="mb-search-input" /><button type="button" className="mb-btn" disabled={submitting || !/^\d+$/.test(manualId.trim())} onClick={() => void bind(manualId.trim())}>{submitting ? "绑定中..." : "绑定"}</button></div></div></div></Modal>;
}
