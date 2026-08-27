import { useMemo, useState } from "react";
import type { InterviewDetail } from "../../lib/api";
import "./LeftPanel.css";

interface LeftPanelProps { interview: InterviewDetail | null; }
type MaterialTab = "resume" | "jd";
const MATERIAL_TABS: Array<{ key: MaterialTab; label: string }> = [{ key: "resume", label: "简历" }, { key: "jd", label: "JD" }];
function splitResume(text?: string) { return text ? text.split(/[。\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 6) : []; }

export default function LeftPanel({ interview }: LeftPanelProps) {
  const [tab, setTab] = useState<MaterialTab>("resume");
  const candidate = interview?.participants?.find((participant) => participant.role === "candidate");
  const resumeLines = useMemo(() => splitResume(interview?.candidate?.resumeText), [interview?.candidate?.resumeText]);
  if (!interview) return null;
  const candidateName = interview.candidate?.displayName || candidate?.displayName || "候选人";
  const strengths = interview.screening?.strengths || [];
  const verificationPoints = interview.screening?.verificationPoints || [];
  return <aside className="left-panel"><div className="lp-head"><h2>候选人材料</h2></div><div className="lp-tabs" role="tablist" aria-label="材料切换">{MATERIAL_TABS.map((item) => <button type="button" key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)} role="tab" aria-selected={tab === item.key}>{item.label}</button>)}</div>{tab === "resume" ? <div className="lp-scroll"><div className="lp-profile"><div className="lp-avatar">{candidateName.slice(0, 2)}</div><div><h3>{candidateName}</h3><p>候选人资料由招聘流程导入</p></div></div><section className="lp-section"><h3>筛选摘要</h3>{strengths.length ? <ul className="lp-list lp-list-positive">{strengths.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="lp-muted">暂无筛选摘要。</p>}</section><details className="lp-disclosure"><summary>查看简历原文摘要</summary>{resumeLines.length ? <div className="lp-resume-text">{resumeLines.map((item, index) => <p key={index}>{item}。</p>)}</div> : <p className="lp-muted">暂无简历文本。</p>}</details></div> : <div className="lp-scroll"><section className="lp-section"><h3>岗位要求</h3><p className="lp-copy">{interview.job?.jdText || "暂无 JD 文本。"}</p></section><section className="lp-section"><h3>内部筛选标准</h3>{interview.job?.internalCriteria?.length ? <ul className="lp-list">{interview.job.internalCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="lp-muted">暂无内部标准。</p>}</section></div>}<section className="lp-section lp-sticky"><h3>本轮待验证</h3>{verificationPoints.length ? <ul className="lp-list lp-list-warning">{verificationPoints.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="lp-muted">暂无待验证问题。</p>}</section></aside>;
}
