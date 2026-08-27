import { describe, expect, it } from "vitest";
import { InterviewPackageSchema } from "@vice/contracts";
import {
  buildInterviewPackage,
  createInitialNewInterviewForm,
  splitList,
  validateNewInterviewForm,
  type NewInterviewFormData,
} from "../../apps/web/src/lib/newInterview";

function validForm(): NewInterviewFormData {
  return {
    candidateName: "候选人示例",
    jobTitle: "AI 产品经理",
    round: "初面",
    scheduledAtLocal: "2026-08-18T10:30",
    durationMinutes: "45",
    interviewerNames: "业务负责人，HRBP",
    jdText: "负责 AI 产品需求分析、方案设计和跨团队落地。",
    resumeText: "候选人有 6 年产品经验，近 3 年负责大模型应用。",
    strengths: "大模型产品经验\n跨团队推动能力",
    verificationPoints: "确认个人贡献边界；核实项目业务结果",
    generatePlan: true,
  };
}

describe("new interview form", () => {
  it("默认安排在次日上午十点", () => {
    const form = createInitialNewInterviewForm(new Date(2026, 7, 14, 16, 20));
    expect(form.scheduledAtLocal).toBe("2026-08-15T10:00");
    expect(form.durationMinutes).toBe("45");
    expect(form.generatePlan).toBe(true);
  });

  it("支持用换行和常见分隔符录入列表", () => {
    expect(splitList("业务负责人，HRBP\n技术负责人、COE；SSC")).toEqual([
      "业务负责人",
      "HRBP",
      "技术负责人",
      "COE",
      "SSC",
    ]);
  });

  it("阻止缺失的核心材料提交", () => {
    const errors = validateNewInterviewForm({
      ...validForm(),
      candidateName: "",
      jdText: "",
      resumeText: "",
      interviewerNames: "",
    });
    expect(errors).toMatchObject({
      candidateName: expect.any(String),
      jdText: expect.any(String),
      resumeText: expect.any(String),
      interviewerNames: expect.any(String),
    });
  });

  it("将表单转换为后端可接受的 InterviewPackage", () => {
    const pkg = buildInterviewPackage(validForm(), {
      now: Date.UTC(2026, 7, 14, 8, 0, 0),
      nonce: "test-nonce-001",
    });
    const parsed = InterviewPackageSchema.safeParse(pkg);

    expect(parsed.success).toBe(true);
    expect(pkg.candidate.displayName).toBe("候选人示例");
    expect(pkg.job.title).toBe("AI 产品经理");
    expect(pkg.interviewers).toHaveLength(2);
    expect(pkg.screening.verificationPoints).toHaveLength(2);
    expect(pkg.interviewId).toMatch(/^manual-interview-/);
  });

  it("在列表字段超过后端限制时给出错误", () => {
    const errors = validateNewInterviewForm({
      ...validForm(),
      interviewerNames: Array.from({ length: 21 }, (_, index) => `面试官${index}`).join("，"),
      strengths: Array.from({ length: 51 }, (_, index) => `优势${index}`).join("\n"),
    });

    expect(errors.interviewerNames).toContain("20");
    expect(errors.strengths).toContain("50");
  });
});
