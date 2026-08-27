import type { InterviewPackage } from "@vice/contracts";

export interface NewInterviewFormData {
  candidateName: string;
  jobTitle: string;
  round: string;
  scheduledAtLocal: string;
  durationMinutes: string;
  interviewerNames: string;
  jdText: string;
  resumeText: string;
  strengths: string;
  verificationPoints: string;
  generatePlan: boolean;
}

export type NewInterviewField = Exclude<keyof NewInterviewFormData, "generatePlan">;
export type NewInterviewErrors = Partial<Record<NewInterviewField, string>>;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function createInitialNewInterviewForm(now = new Date()): NewInterviewFormData {
  const scheduledAt = new Date(now);
  scheduledAt.setDate(scheduledAt.getDate() + 1);
  scheduledAt.setHours(10, 0, 0, 0);

  return {
    candidateName: "",
    jobTitle: "",
    round: "初面",
    scheduledAtLocal: toLocalDateTimeValue(scheduledAt),
    durationMinutes: "45",
    interviewerNames: "",
    jdText: "",
    resumeText: "",
    strengths: "",
    verificationPoints: "",
    generatePlan: true,
  };
}

export function splitList(value: string): string[] {
  return value
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validateNewInterviewForm(data: NewInterviewFormData): NewInterviewErrors {
  const errors: NewInterviewErrors = {};
  const scheduledAt = new Date(data.scheduledAtLocal);
  const duration = Number(data.durationMinutes);
  const interviewers = splitList(data.interviewerNames);
  const strengths = splitList(data.strengths);
  const verificationPoints = splitList(data.verificationPoints);

  if (!data.candidateName.trim()) errors.candidateName = "请输入候选人姓名";
  else if (data.candidateName.trim().length > 120) errors.candidateName = "候选人姓名不能超过 120 个字符";
  if (!data.jobTitle.trim()) errors.jobTitle = "请输入面试岗位";
  else if (data.jobTitle.trim().length > 300) errors.jobTitle = "面试岗位不能超过 300 个字符";
  if (!data.round.trim()) errors.round = "请输入面试轮次";
  else if (data.round.trim().length > 80) errors.round = "面试轮次不能超过 80 个字符";
  if (!data.scheduledAtLocal || Number.isNaN(scheduledAt.getTime())) errors.scheduledAtLocal = "请选择有效的面试时间";
  if (!Number.isInteger(duration) || duration < 1 || duration > 480) errors.durationMinutes = "请输入 1 到 480 分钟";
  if (interviewers.length === 0) errors.interviewerNames = "请至少填写一名面试官";
  else if (interviewers.length > 20) errors.interviewerNames = "面试官不能超过 20 人";
  else if (interviewers.some((name) => name.length > 120)) errors.interviewerNames = "单个面试官姓名不能超过 120 个字符";
  if (!data.jdText.trim()) errors.jdText = "请粘贴岗位 JD";
  else if (data.jdText.length > 100_000) errors.jdText = "岗位 JD 不能超过 10 万个字符";
  if (!data.resumeText.trim()) errors.resumeText = "请粘贴候选人简历文本";
  else if (data.resumeText.length > 200_000) errors.resumeText = "候选人简历不能超过 20 万个字符";
  if (strengths.length > 50 || strengths.some((item) => item.length > 2000)) errors.strengths = "最多填写 50 项优势，单项不能超过 2000 个字符";
  if (verificationPoints.length > 50 || verificationPoints.some((item) => item.length > 2000)) errors.verificationPoints = "最多填写 50 个问题，单项不能超过 2000 个字符";

  return errors;
}

function createNonce() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function buildInterviewPackage(
  data: NewInterviewFormData,
  options: { now?: number; nonce?: string } = {},
): InterviewPackage {
  const now = options.now ?? Date.now();
  const nonce = (options.nonce ?? createNonce()).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  const suffix = `${now.toString(36)}-${nonce}`;

  return {
    schemaVersion: "1.0",
    idempotencyKey: `manual-vice-${suffix}`,
    candidateKey: `manual-candidate-${suffix}`,
    applicationKey: `manual-application-${suffix}`,
    jobKey: `manual-job-${suffix}`,
    interviewId: `manual-interview-${suffix}`,
    round: data.round.trim(),
    scheduledAt: new Date(data.scheduledAtLocal).toISOString(),
    durationMinutes: Number(data.durationMinutes),
    interviewers: splitList(data.interviewerNames).map((name) => ({ name })),
    job: {
      title: data.jobTitle.trim(),
      jdText: data.jdText.trim(),
      internalCriteria: [],
      dimensions: [],
      policyVersion: "manual-entry-v1",
    },
    candidate: {
      displayName: data.candidateName.trim(),
      resumeText: data.resumeText.trim(),
    },
    screening: {
      rating: "pending",
      strengths: splitList(data.strengths),
      verificationPoints: splitList(data.verificationPoints),
      sourceNotes: ["由第二面试官前端人工录入"],
    },
    previousRounds: [],
  };
}
