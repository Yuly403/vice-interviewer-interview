import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../../components/ui";
import { useToast } from "../../hooks/useToast";
import { ApiError, api } from "../../lib/api";
import {
  buildInterviewPackage,
  createInitialNewInterviewForm,
  validateNewInterviewForm,
  type NewInterviewErrors,
  type NewInterviewField,
  type NewInterviewFormData,
} from "../../lib/newInterview";
import "./NewInterviewModal.css";

interface NewInterviewModalProps {
  open: boolean;
  onClose: () => void;
}

type SubmitPhase = "idle" | "importing" | "generating";

function getFieldId(field: NewInterviewField) {
  return `new-interview-${field}`;
}

function getErrorId(field: NewInterviewField) {
  return `${getFieldId(field)}-error`;
}

function getImportErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const suffix = error.requestId ? ` 请求编号：${error.requestId}` : "";
    if (error.code === "INVALID_INTERVIEW_PACKAGE") return `材料格式未通过校验，请检查后重试。${suffix}`;
    if (error.code === "IDEMPOTENCY_CONFLICT") return `检测到重复的面试记录，请关闭表单后刷新列表。${suffix}`;
    return `${error.message || "创建面试失败"}${suffix}`;
  }
  return error instanceof Error ? error.message : "创建面试失败，请稍后重试";
}

export default function NewInterviewModal({ open, onClose }: NewInterviewModalProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<NewInterviewFormData>(() => createInitialNewInterviewForm());
  const [errors, setErrors] = useState<NewInterviewErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const submitting = phase !== "idle";

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    setForm(createInitialNewInterviewForm());
    setErrors({});
    setSubmitError("");
    setPhase("idle");
  }, [open]);

  const updateField = <K extends keyof NewInterviewFormData>(field: K, value: NewInterviewFormData[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field !== "generatePlan") {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
    setSubmitError("");
  };

  const fieldProps = (field: NewInterviewField) => ({
    id: getFieldId(field),
    "aria-invalid": Boolean(errors[field]),
    "aria-describedby": errors[field] ? getErrorId(field) : undefined,
  });

  const renderError = (field: NewInterviewField) => errors[field]
    ? <span className="nim-field-error" id={getErrorId(field)}>{errors[field]}</span>
    : null;

  const handleClose = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async () => {
    const nextErrors = validateNewInterviewForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSubmitError("请先补全标红的必填信息");
      const firstField = Object.keys(nextErrors)[0] as NewInterviewField;
      requestAnimationFrame(() => document.getElementById(getFieldId(firstField))?.focus());
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitError("");
    setPhase("importing");

    let interviewId = "";
    try {
      const imported = await api.importPackage(buildInterviewPackage(form), controller.signal);
      interviewId = imported.data.id;
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = getImportErrorMessage(error);
      setSubmitError(message);
      setPhase("idle");
      toast.error(message);
      return;
    }

    if (form.generatePlan) {
      setPhase("generating");
      try {
        const generated = await api.generatePlan(interviewId, controller.signal);
        if (generated.data.generation?.mode === "rule-based") {
          toast.info("面试已创建，模型暂不可用，已按规则模板生成一页纸");
        } else {
          toast.success("面试已创建，一页纸已生成");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[NewInterviewModal] plan generation failed:", error);
        toast.warning("面试已创建，一页纸暂未生成，可在工作台中重试");
      }
    } else {
      toast.success("面试已创建");
    }

    navigate(`/interview/${encodeURIComponent(interviewId)}`);
  };

  const primaryLabel = phase === "importing"
    ? "正在创建面试..."
    : phase === "generating"
      ? "正在生成一页纸..."
      : form.generatePlan
        ? "创建并生成一页纸"
        : "创建面试";

  return (
    <Modal
      open={open}
      title="新建面试"
      onClose={handleClose}
      closeOnMask={!submitting}
      size="lg"
      actions={[
        { label: "取消", variant: "ghost", onClick: handleClose, disabled: submitting },
        { label: primaryLabel, variant: "primary", onClick: () => void handleSubmit(), loading: submitting },
      ]}
    >
      <form className="nim-form" onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
        <p className="nim-intro">录入本场面试的基本信息和候选人材料。创建后可直接生成面试一页纸。</p>

        {submitError && <div className="nim-submit-error" role="alert">{submitError}</div>}

        <section className="nim-section" aria-labelledby="nim-schedule-title">
          <div className="nim-section-head">
            <h3 id="nim-schedule-title">面试安排</h3>
            <p>用于建立候选人与本场面试的唯一记录。</p>
          </div>
          <div className="nim-grid">
            <label className="nim-field">
              <span>候选人姓名 <b aria-hidden="true">*</b></span>
              <input className="form-input" {...fieldProps("candidateName")} value={form.candidateName} onChange={(event) => updateField("candidateName", event.target.value)} placeholder="例如：候选人示例" maxLength={120} />
              {renderError("candidateName")}
            </label>
            <label className="nim-field">
              <span>面试岗位 <b aria-hidden="true">*</b></span>
              <input className="form-input" {...fieldProps("jobTitle")} value={form.jobTitle} onChange={(event) => updateField("jobTitle", event.target.value)} placeholder="例如：AI 产品经理" maxLength={300} />
              {renderError("jobTitle")}
            </label>
            <label className="nim-field">
              <span>面试轮次 <b aria-hidden="true">*</b></span>
              <input className="form-input" {...fieldProps("round")} value={form.round} onChange={(event) => updateField("round", event.target.value)} placeholder="例如：初面" maxLength={80} />
              {renderError("round")}
            </label>
            <label className="nim-field">
              <span>面试时间 <b aria-hidden="true">*</b></span>
              <input type="datetime-local" className="form-input" {...fieldProps("scheduledAtLocal")} value={form.scheduledAtLocal} onChange={(event) => updateField("scheduledAtLocal", event.target.value)} />
              {renderError("scheduledAtLocal")}
            </label>
            <label className="nim-field">
              <span>预计时长（分钟） <b aria-hidden="true">*</b></span>
              <input type="number" className="form-input" {...fieldProps("durationMinutes")} value={form.durationMinutes} onChange={(event) => updateField("durationMinutes", event.target.value)} min={1} max={480} />
              {renderError("durationMinutes")}
            </label>
            <label className="nim-field">
              <span>面试官 <b aria-hidden="true">*</b></span>
              <input className="form-input" {...fieldProps("interviewerNames")} value={form.interviewerNames} onChange={(event) => updateField("interviewerNames", event.target.value)} placeholder="多人可用逗号分隔" maxLength={1000} />
              {renderError("interviewerNames")}
            </label>
          </div>
        </section>

        <section className="nim-section" aria-labelledby="nim-material-title">
          <div className="nim-section-head">
            <h3 id="nim-material-title">候选人材料</h3>
            <p>当前请粘贴从 PDF 或 Word 中复制的文本。</p>
          </div>
          <div className="nim-material-grid">
            <label className="nim-field">
              <span>岗位 JD <b aria-hidden="true">*</b></span>
              <textarea className="form-textarea nim-material-textarea" {...fieldProps("jdText")} value={form.jdText} onChange={(event) => updateField("jdText", event.target.value)} placeholder="粘贴完整岗位职责、任职要求和内部考察标准" maxLength={100000} rows={8} />
              {renderError("jdText")}
            </label>
            <label className="nim-field">
              <span>候选人简历 <b aria-hidden="true">*</b></span>
              <textarea className="form-textarea nim-material-textarea" {...fieldProps("resumeText")} value={form.resumeText} onChange={(event) => updateField("resumeText", event.target.value)} placeholder="粘贴候选人的完整简历文本" maxLength={200000} rows={8} />
              {renderError("resumeText")}
            </label>
          </div>
          <p className="nim-privacy-note">请仅录入已获得招聘流程授权的候选人材料。测试时优先使用脱敏简历。</p>
        </section>

        <section className="nim-section" aria-labelledby="nim-screening-title">
          <div className="nim-section-head">
            <h3 id="nim-screening-title">筛选交接</h3>
            <p>选填。每行一项，也可以使用逗号分隔。</p>
          </div>
          <div className="nim-material-grid">
            <label className="nim-field">
              <span>候选人优势</span>
              <textarea className="form-textarea" {...fieldProps("strengths")} value={form.strengths} onChange={(event) => updateField("strengths", event.target.value)} placeholder="例如：有从 0 到 1 的 AI 产品经验" maxLength={100000} rows={4} />
              {renderError("strengths")}
            </label>
            <label className="nim-field">
              <span>待验证问题</span>
              <textarea className="form-textarea" {...fieldProps("verificationPoints")} value={form.verificationPoints} onChange={(event) => updateField("verificationPoints", event.target.value)} placeholder="例如：需要确认项目中的个人贡献边界" maxLength={100000} rows={4} />
              {renderError("verificationPoints")}
            </label>
          </div>
        </section>

        <label className="nim-generate-option">
          <input type="checkbox" checked={form.generatePlan} onChange={(event) => updateField("generatePlan", event.target.checked)} />
          <span><strong>创建后立即生成面试一页纸</strong><small>生成失败不会丢失已录入的面试材料，可在工作台中重新生成。</small></span>
        </label>

        <button type="submit" className="nim-hidden-submit" tabIndex={-1} aria-hidden="true">提交</button>
      </form>
    </Modal>
  );
}
