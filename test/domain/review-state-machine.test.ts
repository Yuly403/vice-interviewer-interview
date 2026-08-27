import { describe, it, expect } from "vitest";
import {
  canTransitionReview,
  transitionReview,
  mapReviewToInterviewStatus,
  isReviewTerminal,
  isReviewEditable,
} from "@vice/domain";
import { ReviewStatus as RS } from "@vice/contracts";

describe("review-state-machine", () => {
  // ─── canTransitionReview ───
  describe("canTransitionReview", () => {
    it("should allow NotStarted → Generating", () => {
      expect(canTransitionReview(RS.NotStarted, RS.Generating)).toBe(true);
    });

    it("should allow DraftReady → ApprovalPending", () => {
      expect(canTransitionReview(RS.DraftReady, RS.ApprovalPending)).toBe(true);
    });

    it("should allow DraftReady → Editing", () => {
      expect(canTransitionReview(RS.DraftReady, RS.Editing)).toBe(true);
    });

    it("should allow Approved → SyncPending", () => {
      expect(canTransitionReview(RS.Approved, RS.SyncPending)).toBe(true);
    });

    it("should allow SyncPending → SyncConflict", () => {
      expect(canTransitionReview(RS.SyncPending, RS.SyncConflict)).toBe(true);
    });

    it("should allow SyncConflict → SyncPending", () => {
      expect(canTransitionReview(RS.SyncConflict, RS.SyncPending)).toBe(true);
    });

    it("should deny Synced → anything (terminal)", () => {
      expect(canTransitionReview(RS.Synced, RS.SyncPending)).toBe(false);
    });

    it("should deny NotStarted → Approved (skip states)", () => {
      expect(canTransitionReview(RS.NotStarted, RS.Approved)).toBe(false);
    });
  });

  // ─── transitionReview ───
  describe("transitionReview", () => {
    it("should succeed with no guards", () => {
      const result = transitionReview(RS.NotStarted, RS.Generating);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.newStatus).toBe(RS.Generating);
    });

    it("should fail on workspaceConflictsResolved=false", () => {
      const result = transitionReview(RS.Approved, RS.SyncPending, {
        workspaceConflictsResolved: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("workspaceConflictsResolved");
    });

    it("should fail on evidenceValidationPassed=false", () => {
      const result = transitionReview(RS.DraftReady, RS.ApprovalPending, {
        evidenceValidationPassed: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("evidenceValidationPassed");
    });

    it("should fail on strongIdentity=false", () => {
      const result = transitionReview(RS.DraftReady, RS.ApprovalPending, {
        strongIdentity: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("strongIdentity");
    });

    it("should succeed with all guards true", () => {
      const result = transitionReview(RS.DraftReady, RS.ApprovalPending, {
        workspaceConflictsResolved: true,
        evidenceValidationPassed: true,
        strongIdentity: true,
        idempotencyKey: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.newStatus).toBe(RS.ApprovalPending);
    });
  });

  // ─── mapReviewToInterviewStatus ───
  describe("mapReviewToInterviewStatus", () => {
    it("should map DraftReady → review_draft", () => {
      expect(mapReviewToInterviewStatus(RS.DraftReady)).toBe("review_draft");
    });

    it("should map Approved → review_approved", () => {
      expect(mapReviewToInterviewStatus(RS.Approved)).toBe("review_approved");
    });

    it("should map Synced → synced", () => {
      expect(mapReviewToInterviewStatus(RS.Synced)).toBe("synced");
    });

    it("should return undefined for NotStarted", () => {
      expect(mapReviewToInterviewStatus(RS.NotStarted)).toBeUndefined();
    });
  });

  // ─── isReviewTerminal ───
  describe("isReviewTerminal", () => {
    it("should identify Synced as terminal", () => {
      expect(isReviewTerminal(RS.Synced)).toBe(true);
    });

    it("should not identify other states as terminal", () => {
      expect(isReviewTerminal(RS.DraftReady)).toBe(false);
      expect(isReviewTerminal(RS.Approved)).toBe(false);
      expect(isReviewTerminal(RS.SyncConflict)).toBe(false);
    });
  });

  // ─── isReviewEditable ───
  describe("isReviewEditable", () => {
    it("should identify DraftReady as editable", () => {
      expect(isReviewEditable(RS.DraftReady)).toBe(true);
    });

    it("should identify Editing as editable", () => {
      expect(isReviewEditable(RS.Editing)).toBe(true);
    });

    it("should not identify Approved as editable", () => {
      expect(isReviewEditable(RS.Approved)).toBe(false);
    });
  });

  // ─── Sync flow integration ───
  describe("sync flow", () => {
    it("Approved → SyncPending → SyncConflict → SyncPending → Synced is valid", () => {
      const t1 = transitionReview(RS.Approved, RS.SyncPending);
      expect(t1.ok).toBe(true);
      if (!t1.ok) return;

      const t2 = transitionReview(t1.newStatus, RS.SyncConflict);
      expect(t2.ok).toBe(true);
      if (!t2.ok) return;

      const t3 = transitionReview(t2.newStatus, RS.SyncPending);
      expect(t3.ok).toBe(true);
      if (!t3.ok) return;

      const t4 = transitionReview(t3.newStatus, RS.Synced);
      expect(t4.ok).toBe(true);
      if (t4.ok) expect(t4.newStatus).toBe(RS.Synced);
    });
  });
});
