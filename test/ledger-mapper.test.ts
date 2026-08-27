/**
 * 台账状态映射器（SYNC-002）单元测试
 *
 * 覆盖 mapToLedgerStatus 的 6 条 PRD 规则 + 辅助函数
 */
import { describe, it, expect } from "vitest";
import { LedgerStatus } from "@vice/contracts";
import {
  mapToLedgerStatus,
  computeLedgerStatus,
  isLedgerAutoEffective,
  getLedgerLabel,
} from "@vice/domain";
import type { LedgerMappingInput } from "@vice/domain";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<LedgerMappingInput> = {}): LedgerMappingInput {
  return {
    interviewStatus: "bound",
    reviewStatus: null,
    suggestedDecision: null,
    humanDecision: null,
    isFinalRound: false,
    currentLedgerStatus: null,
    ...overrides,
  };
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

describe("getLedgerLabel", () => {
  it("returns Chinese label for known statuses", () => {
    expect(getLedgerLabel(LedgerStatus.NotSet)).toBe("未设置");
    expect(getLedgerLabel(LedgerStatus.InProgress)).toBe("面试中");
    expect(getLedgerLabel(LedgerStatus.EvaluationPending)).toBe("面评待确认");
    expect(getLedgerLabel(LedgerStatus.NextRound)).toBe("进入下一轮");
    expect(getLedgerLabel(LedgerStatus.OfferEvaluation)).toBe("Offer 评估");
    expect(getLedgerLabel(LedgerStatus.PendingConfirm)).toBe("待确认");
    expect(getLedgerLabel(LedgerStatus.Rejected)).toBe("已拒");
  });

  it("returns raw status for unknown values", () => {
    expect(getLedgerLabel("UnknownStatus")).toBe("UnknownStatus");
  });
});

describe("computeLedgerStatus", () => {
  it("returns ledger status string for live interview", () => {
    const result = computeLedgerStatus(makeInput({ interviewStatus: "bound" }));
    expect(result).toBe(LedgerStatus.InProgress);
  });
});

describe("isLedgerAutoEffective", () => {
  it("returns true for live interview status", () => {
    expect(isLedgerAutoEffective(makeInput({ interviewStatus: "bound" }))).toBe(true);
    expect(isLedgerAutoEffective(makeInput({ interviewStatus: "capturing" }))).toBe(true);
    expect(isLedgerAutoEffective(makeInput({ interviewStatus: "live" }))).toBe(true);
  });

  it("returns false for evaluation pending", () => {
    expect(isLedgerAutoEffective(makeInput({
      interviewStatus: "review_draft",
      reviewStatus: "draft_ready",
      suggestedDecision: "pass",
    }))).toBe(false);
  });
});

// ─── Rule 1: 面试进行中 → 面试中 ──────────────────────────────────────────────

describe("mapToLedgerStatus — Rule 1: live interview → in_progress", () => {
  const liveStatuses = ["bound", "capturing", "live", "ending", "ended", "transcript_finalizing"];

  for (const s of liveStatuses) {
    it(`"${s}" → in_progress (auto)`, () => {
      const result = mapToLedgerStatus(makeInput({ interviewStatus: s }));
      expect(result.status).toBe(LedgerStatus.InProgress);
      expect(result.autoEffective).toBe(true);
      expect(result.label).toBe("面试中");
    });
  }
});

// ─── Rule 2: 面评草稿（未审批） ────────────────────────────────────────────────

describe("mapToLedgerStatus — Rule 2: review draft", () => {
  it("AI 建议淘汰 → pending_confirm (manual)", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_draft",
      suggestedDecision: "reject",
    }));
    expect(result.status).toBe(LedgerStatus.PendingConfirm);
    expect(result.autoEffective).toBe(false);
    expect(result.note).toContain("AI 建议淘汰");
  });

  it("草稿已完成未审批 → evaluation_pending (manual)", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_draft",
      reviewStatus: "draft_ready",
      suggestedDecision: "pass",
    }));
    expect(result.status).toBe(LedgerStatus.EvaluationPending);
    expect(result.autoEffective).toBe(false);
  });

  it("面评生成中 → in_progress (auto)", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_generating",
      reviewStatus: null,
    }));
    expect(result.status).toBe(LedgerStatus.InProgress);
    expect(result.autoEffective).toBe(true);
  });
});

// ─── Rule 3: Pass + 终面 → OfferEvaluation ──────────────────────────────────

describe("mapToLedgerStatus — Rule 3: pass + final round → offer_evaluation", () => {
  it("pass + isFinalRound → offer_evaluation (manual)", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_approved",
      humanDecision: "pass",
      isFinalRound: true,
      suggestedDecision: "pass",
    }));
    expect(result.status).toBe(LedgerStatus.OfferEvaluation);
    expect(result.autoEffective).toBe(false);
    expect(result.note).toContain("终面通过");
  });
});

// ─── Rule 4: Pass + 非终面 → NextRound ──────────────────────────────────────

describe("mapToLedgerStatus — Rule 4: pass + non-final → next_round", () => {
  it("pass + !isFinalRound → next_round (auto)", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_approved",
      humanDecision: "pass",
      isFinalRound: false,
      suggestedDecision: "pass",
    }));
    expect(result.status).toBe(LedgerStatus.NextRound);
    expect(result.autoEffective).toBe(true);
    expect(result.note).toContain("进入下一轮");
  });
});

// ─── Rule 5: Hold → PendingConfirm ──────────────────────────────────────────

describe("mapToLedgerStatus — Rule 5: hold → pending_confirm", () => {
  it("humanDecision=hold → pending_confirm (manual)", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_approved",
      humanDecision: "hold",
      suggestedDecision: "pass",
    }));
    expect(result.status).toBe(LedgerStatus.PendingConfirm);
    expect(result.autoEffective).toBe(false);
    expect(result.note).toContain("待定");
  });
});

// ─── Rule 6: Reject → Rejected ──────────────────────────────────────────────

describe("mapToLedgerStatus — Rule 6: reject → rejected", () => {
  it("humanDecision=reject → rejected (manual)", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_approved",
      humanDecision: "reject",
      suggestedDecision: "reject",
    }));
    expect(result.status).toBe(LedgerStatus.Rejected);
    expect(result.autoEffective).toBe(false);
    expect(result.note).toContain("已拒");
  });
});

// ─── 变更检测 ────────────────────────────────────────────────────────────────

describe("mapToLedgerStatus — transition detection", () => {
  it("returns transition when status changes", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_approved",
      humanDecision: "pass",
      isFinalRound: false,
      currentLedgerStatus: LedgerStatus.InProgress,
    }));
    expect(result.transition).not.toBeNull();
    expect(result.transition!.from).toBe(LedgerStatus.InProgress);
    expect(result.transition!.to).toBe(LedgerStatus.NextRound);
    expect(result.transition!.source).toBe("auto");
  });

  it("returns null transition when status unchanged", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "bound",
      currentLedgerStatus: LedgerStatus.InProgress,
    }));
    expect(result.transition).toBeNull();
  });

  it("transition includes triggeredBy fields", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_approved",
      humanDecision: "reject",
      suggestedDecision: "pass",
      isFinalRound: false,
      currentLedgerStatus: LedgerStatus.InProgress,
    }));
    expect(result.transition!.triggeredByInterviewStatus).toBe("review_approved");
    expect(result.transition!.triggeredByHumanDecision).toBe("reject");
    expect(result.transition!.triggeredBySuggestedDecision).toBe("pass");
    expect(result.transition!.isFinalRound).toBe(false);
  });
});

// ─── 边界情况 ────────────────────────────────────────────────────────────────

describe("mapToLedgerStatus — edge cases", () => {
  it("已审批但缺少 humanDecision → evaluation_pending", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "review_approved",
      humanDecision: null,
    }));
    expect(result.status).toBe(LedgerStatus.EvaluationPending);
    expect(result.autoEffective).toBe(false);
  });

  it("fallback: created → in_progress", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "created",
    }));
    expect(result.status).toBe(LedgerStatus.InProgress);
    expect(result.autoEffective).toBe(false);
  });

  it("closed → in_progress (fallback)", () => {
    const result = mapToLedgerStatus(makeInput({
      interviewStatus: "closed",
    }));
    expect(result.status).toBe(LedgerStatus.InProgress);
  });
});
