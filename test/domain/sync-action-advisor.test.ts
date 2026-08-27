import { describe, it, expect } from "vitest";
import { generateSyncActions, SyncActionType, ActionPriority, TargetRole } from "@vice/domain";
import type { AdvisorInput } from "@vice/domain";
import { HumanDecision as HD, LedgerStatus as LS } from "@vice/contracts";

// ─── Test helpers ───

function makeInput(overrides: Partial<AdvisorInput> = {}): AdvisorInput {
  return {
    humanDecision: HD.Pass,
    suggestedDecision: HD.Pass,
    isFinalRound: false,
    ledgerStatus: LS.NextRound,
    ledgerAutoEffective: true,
    openQuestionCount: 0,
    uncoveredTopicCount: 0,
    nextRoundFocusCount: 3,
    evidenceCount: 5,
    strengthCount: 3,
    riskCount: 1,
    hadConflicts: false,
    ...overrides,
  };
}

// ─── Tests ───

describe("sync-action-advisor", () => {
  // ═══════════════════════════════════════════════
  // Rule 1: Decision-driven primary actions
  // ═══════════════════════════════════════════════
  describe("decision-driven primary actions", () => {
    it("pass + non-final round → schedule_next_round", () => {
      const result = generateSyncActions(makeInput({ humanDecision: HD.Pass, isFinalRound: false }));
      expect(result.primaryAction).not.toBeNull();
      expect(result.primaryAction!.type).toBe(SyncActionType.ScheduleNextRound);
      expect(result.primaryAction!.priority).toBe(ActionPriority.High);
    });

    it("pass + final round → offer_evaluation", () => {
      const result = generateSyncActions(makeInput({ humanDecision: HD.Pass, isFinalRound: true }));
      expect(result.primaryAction!.type).toBe(SyncActionType.OfferEvaluation);
      expect(result.primaryAction!.priority).toBe(ActionPriority.High);
    });

    it("reject → send_rejection", () => {
      const result = generateSyncActions(makeInput({
        humanDecision: HD.Reject,
        isFinalRound: false,
        ledgerAutoEffective: true,
      }));
      expect(result.primaryAction!.type).toBe(SyncActionType.SendRejection);
      expect(result.primaryAction!.priority).toBe(ActionPriority.High);
    });

    it("hold → gather_more_info", () => {
      const result = generateSyncActions(makeInput({ humanDecision: HD.Hold }));
      expect(result.primaryAction!.type).toBe(SyncActionType.GatherMoreInfo);
      expect(result.primaryAction!.priority).toBe(ActionPriority.High);
    });

    it("null decision → gather_more_info (fallback)", () => {
      const result = generateSyncActions(makeInput({ humanDecision: null }));
      expect(result.primaryAction!.type).toBe(SyncActionType.GatherMoreInfo);
      expect(result.primaryAction!.description).toContain("缺少人工结论");
    });

    it("pass + next round should include focus hint in description", () => {
      const result = generateSyncActions(makeInput({
        humanDecision: HD.Pass,
        isFinalRound: false,
        nextRoundFocusCount: 5,
      }));
      const action = result.actions.find((a) => a.type === SyncActionType.ScheduleNextRound);
      expect(action!.description).toContain("5 个重点方向");
    });
  });

  // ═══════════════════════════════════════════════
  // Rule 2: Ledger actions
  // ═══════════════════════════════════════════════
  describe("ledger actions", () => {
    it("should suggest confirm_ledger_change when not auto-effective", () => {
      const result = generateSyncActions(makeInput({ ledgerAutoEffective: false }));
      const action = result.actions.find((a) => a.type === SyncActionType.ConfirmLedgerChange);
      expect(action).toBeDefined();
      expect(action!.priority).toBe(ActionPriority.High);
    });

    it("should mark update_ledger as low when auto-effective", () => {
      const result = generateSyncActions(makeInput({ ledgerAutoEffective: true }));
      const action = result.actions.find((a) => a.type === SyncActionType.UpdateLedger);
      expect(action).toBeDefined();
      expect(action!.priority).toBe(ActionPriority.Low);
    });

    it("reject with autoEffective=false → offer_evaluation dependsOn contains confirm_ledger_change", () => {
      const primary = generateSyncActions(makeInput({
        humanDecision: HD.Pass,
        isFinalRound: true,
        ledgerAutoEffective: false,
      })).primaryAction!;
      expect(primary.dependsOn).toContain(SyncActionType.ConfirmLedgerChange);
    });

    it("reject with autoEffective=true → send_rejection dependsOn is empty", () => {
      const primary = generateSyncActions(makeInput({
        humanDecision: HD.Reject,
        ledgerAutoEffective: true,
      })).primaryAction!;
      expect(primary.dependsOn).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════
  // Rule 3: Evidence gaps
  // ═══════════════════════════════════════════════
  describe("evidence gaps", () => {
    it("should suggest fill_evidence_gap when open questions exist", () => {
      const result = generateSyncActions(makeInput({ openQuestionCount: 3 }));
      const action = result.actions.find((a) => a.type === SyncActionType.FillEvidenceGap);
      expect(action).toBeDefined();
      expect(action!.description).toContain("3 个待确认问题");
    });

    it("should suggest fill_evidence_gap when uncovered topics exist", () => {
      const result = generateSyncActions(makeInput({ uncoveredTopicCount: 2 }));
      const action = result.actions.find((a) => a.type === SyncActionType.FillEvidenceGap);
      expect(action).toBeDefined();
      expect(action!.description).toContain("2 个未覆盖话题");
    });

    it("should suggest fill_evidence_gap when evidence count is low", () => {
      const result = generateSyncActions(makeInput({ evidenceCount: 1 }));
      const action = result.actions.find((a) => a.type === SyncActionType.FillEvidenceGap);
      expect(action).toBeDefined();
      expect(action!.description).toContain("证据引用较少");
    });

    it("should NOT suggest fill_evidence_gap when everything is covered", () => {
      const result = generateSyncActions(makeInput({
        openQuestionCount: 0,
        uncoveredTopicCount: 0,
        evidenceCount: 5,
      }));
      const action = result.actions.find((a) => a.type === SyncActionType.FillEvidenceGap);
      expect(action).toBeUndefined();
    });

    it("hold + evidence gap → fill_evidence_gap is high priority", () => {
      const result = generateSyncActions(makeInput({
        humanDecision: HD.Hold,
        openQuestionCount: 2,
      }));
      const action = result.actions.find((a) => a.type === SyncActionType.FillEvidenceGap);
      expect(action!.priority).toBe(ActionPriority.High);
    });

    it("pass + evidence gap → fill_evidence_gap is medium priority", () => {
      const result = generateSyncActions(makeInput({
        humanDecision: HD.Pass,
        uncoveredTopicCount: 1,
      }));
      const action = result.actions.find((a) => a.type === SyncActionType.FillEvidenceGap);
      expect(action!.priority).toBe(ActionPriority.Medium);
    });
  });

  // ═══════════════════════════════════════════════
  // Rule 4: Notify team
  // ═══════════════════════════════════════════════
  describe("notify team", () => {
    it("should always include notify_team action", () => {
      const result = generateSyncActions(makeInput());
      const action = result.actions.find((a) => a.type === SyncActionType.NotifyTeam);
      expect(action).toBeDefined();
      expect(action!.priority).toBe(ActionPriority.Medium);
      expect(action!.autoTriggerable).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════
  // Rule 5: Archive review
  // ═══════════════════════════════════════════════
  describe("archive review", () => {
    it("should always include archive_review action", () => {
      const result = generateSyncActions(makeInput());
      const action = result.actions.find((a) => a.type === SyncActionType.ArchiveReview);
      expect(action).toBeDefined();
      expect(action!.priority).toBe(ActionPriority.Low);
    });

    it("should mention evidence count in description", () => {
      const result = generateSyncActions(makeInput({ evidenceCount: 7 }));
      const action = result.actions.find((a) => a.type === SyncActionType.ArchiveReview);
      expect(action!.description).toContain("7 条证据引用");
    });
  });

  // ═══════════════════════════════════════════════
  // Rule 6: Conflict recovery
  // ═══════════════════════════════════════════════
  describe("conflict recovery", () => {
    it("should add conflict-resolved action when hadConflicts=true", () => {
      const result = generateSyncActions(makeInput({ hadConflicts: true }));
      const action = result.actions.find((a) => a.title === "冲突已解决，重新同步成功");
      expect(action).toBeDefined();
      expect(action!.priority).toBe(ActionPriority.Medium);
    });

    it("should NOT add conflict-resolved action when hadConflicts=false", () => {
      const result = generateSyncActions(makeInput({ hadConflicts: false }));
      const action = result.actions.find((a) => a.title === "冲突已解决，重新同步成功");
      expect(action).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════
  // Output structure
  // ═══════════════════════════════════════════════
  describe("output structure", () => {
    it("should return AdvisorOutput with all fields", () => {
      const result = generateSyncActions(makeInput());
      expect(result.actions).toBeInstanceOf(Array);
      expect(result.total).toBeGreaterThan(0);
      expect(result.total).toBe(result.actions.length);
      expect(result.primaryAction).not.toBeNull();
      expect(result.summary).toBeTruthy();
    });

    it("should have accurate breakdown counts", () => {
      const result = generateSyncActions(makeInput());
      const actualHigh = result.actions.filter((a) => a.priority === ActionPriority.High).length;
      const actualMedium = result.actions.filter((a) => a.priority === ActionPriority.Medium).length;
      const actualLow = result.actions.filter((a) => a.priority === ActionPriority.Low).length;
      expect(result.breakdown.high).toBe(actualHigh);
      expect(result.breakdown.medium).toBe(actualMedium);
      expect(result.breakdown.low).toBe(actualLow);
    });

    it("should sort actions by priority (high → medium → low)", () => {
      const result = generateSyncActions(makeInput());
      const priorities = result.actions.map((a) => a.priority);
      const ordered = priorities.every((p, i) => {
        if (i === 0) return true;
        const order = { high: 0, medium: 1, low: 2 };
        return order[priorities[i - 1]] <= order[p];
      });
      expect(ordered).toBe(true);
    });

    it("should put decision action first among same priority", () => {
      const result = generateSyncActions(makeInput({
        humanDecision: HD.Reject,
        ledgerAutoEffective: false,
        openQuestionCount: 1,
      }));
      // primaryAction should be the decision action
      const decisionTypes = [
        SyncActionType.ScheduleNextRound,
        SyncActionType.OfferEvaluation,
        SyncActionType.SendRejection,
        SyncActionType.GatherMoreInfo,
      ];
      expect(decisionTypes).toContain(result.primaryAction!.type);
    });

    it("summary should contain human-readable text", () => {
      const passResult = generateSyncActions(makeInput({ humanDecision: HD.Pass, isFinalRound: false }));
      expect(passResult.summary).toContain("建议安排下一轮面试");

      const rejectResult = generateSyncActions(makeInput({ humanDecision: HD.Reject }));
      expect(rejectResult.summary).toContain("建议发送婉拒通知");

      const holdResult = generateSyncActions(makeInput({ humanDecision: HD.Hold }));
      expect(holdResult.summary).toContain("待定");
    });

    it("summary should mention gap count when applicable", () => {
      const result = generateSyncActions(makeInput({
        openQuestionCount: 2,
        uncoveredTopicCount: 1,
      }));
      expect(result.summary).toContain("3 个信息缺口");
    });
  });
});
