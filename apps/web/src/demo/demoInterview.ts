import type { InterviewPackage } from "@vice/contracts";

export function createDemoInterviewPackage(): InterviewPackage {
  const now = Date.now();
  const scheduledAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const suffix = now.toString(36);

  return {
    schemaVersion: "1.0",
    idempotencyKey: `demo-vice-interviewer-${suffix}`,
    candidateKey: `demo-candidate-lincheng-${suffix}`,
    applicationKey: `demo-application-ai-pm-${suffix}`,
    jobKey: `demo-job-ai-product-manager-${suffix}`,
    interviewId: `demo-interview-${suffix}`,
    round: "初面",
    scheduledAt,
    durationMinutes: 45,
    interviewers: [{ name: "业务负责人" }, { name: "HRBP" }],
    job: {
      title: "AI 产品经理",
      jdText:
        "负责 AI 产品从需求洞察、方案设计、Prompt 与工作流编排、数据验证到跨团队落地的完整闭环；需要能把复杂技术能力翻译成业务可理解、可验收、可复盘的产品方案。",
      internalCriteria: [
        "能独立拆解 AI 场景，定义可验证的业务目标和指标。",
        "具备跨算法、工程、运营和业务团队推进能力。",
        "能识别大模型产品中的边界、风险和失败条件。",
        "面试结论必须基于候选人原话证据，不做无依据判断。",
      ],
      dimensions: ["项目贡献边界", "AI 项目落地深度", "指标判断与结果", "复杂协作与推进", "动机与稳定性"],
      policyVersion: "demo-2026-07",
    },
    candidate: {
      displayName: "林澄",
      resumeText:
        "完全虚构的演示数据｜林澄，6 年产品经验，最近任职于星桥软件有限公司。近 3 年专注大模型应用落地，经历过从通用模型探索到 Agent 工作流规模化的业务周期。能够撰写 PRD 和 Prompt，使用 SQL 与 Python 验证假设，并协调算法、工程和业务团队推动方案落地。",
      resumeHash: `demo-resume-${suffix}`,
    },
    screening: {
      rating: "recommend",
      strengths: [
        "6 年产品经验，近 3 年专注大模型应用落地。",
        "同时具备 PRD、Prompt、SQL/Python 取数和跨团队推进能力。",
        "经历过从探索期到规模化的完整产品周期。",
      ],
      verificationPoints: [
        "候选人在 AI 项目中负责哪一段，个人贡献边界需要进一步确认。",
        "项目效果如何衡量，是否有稳定指标和业务结果。",
        "遇到业务方不配合时如何推进。",
        "是否能把复杂技术转化为业务可理解的产品方案。",
      ],
      sourceNotes: ["synthetic：完全虚构，仅用于面试技术验证，不包含真实候选人信息。"],
    },
    previousRounds: [],
  };
}
