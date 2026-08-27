export { canTransition, transition, isTerminal, isLive, transitionReviewApprovedToSynced } from "./state-machine.js";
export type { TransitionGuards } from "./state-machine.js";
export {
  canTransitionReview,
  transitionReview,
  mapReviewToInterviewStatus,
  isReviewTerminal,
  isReviewEditable,
} from "./review-state-machine.js";
export type { ReviewTransitionGuards, SyncConflict } from "./review-state-machine.js";
export {
  validateEvidenceRefs,
  validateReviewConclusion,
  computeDedupKey,
  shouldUpsert,
  computeTopicCoverage,
  ReminderBudget,
} from "./validation.js";
export type { EvidenceValidationResult, EvidenceError } from "./validation.js";
export { generateInterviewArchive, toSafeName } from "./interview-archive.js";
export type { ArchiveInput, ArchiveOutput, ArchiveParticipant, ArchiveConclusion, ArchiveEvidence, ArchiveTopic } from "./interview-archive.js";
export {
  mapToLedgerStatus,
  computeLedgerStatus,
  isLedgerAutoEffective,
  getLedgerLabel,
} from "./ledger-mapper.js";
export type { LedgerMappingInput, LedgerMappingOutput } from "./ledger-mapper.js";
export {
  detectSyncConflicts,
  parseExistingSyncMeta,
  isAutoResolvable,
} from "./sync-conflict-detector.js";
export type {
  DetectionInput,
  DetectionDraft,
  DetectionConclusion,
  DetectionEvidenceRef,
  DetectionTranscriptLine,
  DetectionExistingMeta,
  SyncConflictDetail,
  SyncConflictDetectionResult,
  ResolveAction,
  ResolveResult,
} from "./sync-conflict-detector.js";
export { generateSyncActions, SyncActionType, ActionPriority, TargetRole } from "./sync-action-advisor.js";
export type { SyncAction, AdvisorInput, AdvisorOutput } from "./sync-action-advisor.js";
