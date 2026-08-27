import { describe, it, expect } from "vitest";
import { InterviewStatus as IS } from "@vice/contracts";
import { canTransition, transition, isTerminal, isLive, transitionReviewApprovedToSynced } from "@vice/domain";

describe("state-machine", () => {
  // ─── canTransition ───
  describe("canTransition", () => {
    it("should allow Created → PackageImported", () => {
      expect(canTransition(IS.Created, IS.PackageImported)).toBe(true);
    });

    it("should allow Created → Cancelled", () => {
      expect(canTransition(IS.Created, IS.Cancelled)).toBe(true);
    });

    it("should deny Created → ReviewDraft (skip states)", () => {
      expect(canTransition(IS.Created, IS.ReviewDraft)).toBe(false);
    });

    it("should deny ReviewApproved → anything except Synced", () => {
      expect(canTransition(IS.ReviewApproved, IS.Synced)).toBe(true);
      expect(canTransition(IS.ReviewApproved, IS.Closed)).toBe(false);
      expect(canTransition(IS.ReviewApproved, IS.ReviewDraft)).toBe(false);
    });

    it("should allow Synced → Closed", () => {
      expect(canTransition(IS.Synced, IS.Closed)).toBe(true);
    });

    it("should deny Closed → anything (terminal)", () => {
      expect(canTransition(IS.Closed, IS.Synced)).toBe(false);
      expect(canTransition(IS.Closed, IS.ReviewDraft)).toBe(false);
    });

    it("should allow AttentionRequired → many recovery states", () => {
      expect(canTransition(IS.AttentionRequired, IS.Created)).toBe(true);
      expect(canTransition(IS.AttentionRequired, IS.Ready)).toBe(true);
      expect(canTransition(IS.AttentionRequired, IS.Live)).toBe(true);
      expect(canTransition(IS.AttentionRequired, IS.ReviewDraft)).toBe(true);
    });

    it("should deny AttentionRequired → Closed (not in recovery list)", () => {
      expect(canTransition(IS.AttentionRequired, IS.Closed)).toBe(false);
    });
  });

  // ─── transition ───
  describe("transition", () => {
    it("should succeed with no guards", () => {
      const result = transition(IS.Created, IS.PackageImported);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.newStatus).toBe(IS.PackageImported);
    });

    it("should fail when transition not allowed", () => {
      const result = transition(IS.Created, IS.Synced);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("Cannot transition");
    });

    it("should fail when a guard is false", () => {
      const result = transition(IS.ReviewApproved, IS.Synced, {
        workspaceConflictsResolved: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("workspaceConflictsResolved");
    });

    it("should succeed when guards are all true or undefined", () => {
      const result = transition(IS.ReviewApproved, IS.Synced, {
        workspaceConflictsResolved: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.newStatus).toBe(IS.Synced);
    });

    it("should fail on structureValid guard", () => {
      const result = transition(IS.PackageImported, IS.PlanGenerating, {
        structureValid: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("structureValid");
    });

    it("should fail on transcriptAvailable guard", () => {
      const result = transition(IS.Ended, IS.TranscriptFinalizing, {
        transcriptAvailable: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("transcriptAvailable");
    });
  });

  // ─── transitionReviewApprovedToSynced ───
  describe("transitionReviewApprovedToSynced", () => {
    it("should succeed with workspaceConflictsResolved=true", () => {
      const result = transitionReviewApprovedToSynced(true);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.newStatus).toBe(IS.Synced);
    });

    it("should fail with workspaceConflictsResolved=false", () => {
      const result = transitionReviewApprovedToSynced(false);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("workspaceConflictsResolved");
    });
  });

  // ─── isTerminal ───
  describe("isTerminal", () => {
    it("should identify terminal states", () => {
      expect(isTerminal(IS.Closed)).toBe(true);
      expect(isTerminal(IS.Cancelled)).toBe(true);
      expect(isTerminal(IS.Ended)).toBe(true);
    });

    it("should not identify non-terminal states", () => {
      expect(isTerminal(IS.Created)).toBe(false);
      expect(isTerminal(IS.Synced)).toBe(false);
      expect(isTerminal(IS.Live)).toBe(false);
      expect(isTerminal(IS.ReviewDraft)).toBe(false);
    });
  });

  // ─── isLive ───
  describe("isLive", () => {
    it("should identify live states", () => {
      expect(isLive(IS.Live)).toBe(true);
      expect(isLive(IS.Capturing)).toBe(true);
    });

    it("should not identify non-live states", () => {
      expect(isLive(IS.Created)).toBe(false);
      expect(isLive(IS.Ended)).toBe(false);
      expect(isLive(IS.ReviewApproved)).toBe(false);
    });
  });

  // ─── Full lifecycle traversal ───
  describe("full lifecycle", () => {
    const happyPath = [
      [IS.Created, IS.PackageImported],
      [IS.PackageImported, IS.PlanGenerating],
      [IS.PlanGenerating, IS.PlanDraft],
      [IS.PlanDraft, IS.Ready],
      [IS.Ready, IS.Binding],
      [IS.Binding, IS.Bound],
      [IS.Bound, IS.Capturing],
      [IS.Capturing, IS.Live],
      [IS.Live, IS.Ending],
      [IS.Ending, IS.Ended],
      [IS.Ended, IS.TranscriptFinalizing],
      [IS.TranscriptFinalizing, IS.ReviewGenerating],
      [IS.ReviewGenerating, IS.ReviewDraft],
      [IS.ReviewDraft, IS.ReviewApproved],
      [IS.ReviewApproved, IS.Synced],
      [IS.Synced, IS.Closed],
    ] as const;

    it("all happy-path transitions should be valid", () => {
      for (const [from, to] of happyPath) {
        expect(canTransition(from, to)).toBe(true);
      }
    });

    it("happy-path transitions should return ok", () => {
      for (const [from, to] of happyPath) {
        const result = transition(from, to);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.newStatus).toBe(to);
      }
    });
  });
});
