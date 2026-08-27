import { z } from "zod";
import {
  InterviewStatus,
  TopicStatus,
  CriterionResult,
  SpeakerRole,
  RoleSource,
  ContentType,
  HumanDecision,
  SuggestionKind,
  TranscriptSource,
} from "./enums.js";

// ─── Primitive IDs ───
export const UuidSchema = z.string().uuid();
export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

// ─── Source Reference ───
export const SourceRefSchema = z.object({
  sourceType: z.enum(["jd", "resume", "screening", "previous_review"]),
  sourceId: z.string(),
  revision: z.number().int().positive().optional(),
  quote: z.string().min(1),
  paragraphIndex: z.number().int().nonnegative().optional(),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;

// ─── Criterion ───
export const CriterionSchema = z.object({
  id: UuidSchema.optional(),
  text: z.string().min(1),
  status: z.nativeEnum(CriterionResult).default(CriterionResult.Missing),
  evidenceLineIds: z.array(z.string()).default([]),
  aiExplanation: z.string().optional(),
  humanOverrideValue: z.nativeEnum(CriterionResult).optional(),
  updatedAt: z.string().datetime().optional(),
});

export type Criterion = z.infer<typeof CriterionSchema>;

// ─── Topic ───
export const TopicSchema = z.object({
  id: UuidSchema.optional(),
  title: z.string().min(1),
  why: z.string().min(1),
  openingQuestion: z.string().min(1),
  criteria: z.array(CriterionSchema).min(1),
  followups: z.array(z.string()).default([]),
  goodSignals: z.array(z.string()).default([]),
  riskSignals: z.array(z.string()).default([]),
  sourceRefs: z.array(SourceRefSchema).default([]),
  priority: z.enum(["high", "medium", "low"]),
  estimatedMinutes: z.number().int().positive().max(120),
  status: z.nativeEnum(TopicStatus).default(TopicStatus.Unasked),
  locked: z.boolean().default(false),
  skipped: z.boolean().default(false),
  sortOrder: z.number().int().nonnegative(),
});

export type Topic = z.infer<typeof TopicSchema>;

// ─── Interview Plan ───
export const InterviewPlanSchema = z.object({
  id: UuidSchema.optional(),
  interviewId: z.string(),
  revision: z.number().int().positive().default(1),
  topics: z.array(TopicSchema).min(1).max(12),
  openingBudgetMinutes: z.number().int().nonnegative().default(5),
  closingBudgetMinutes: z.number().int().nonnegative().default(5),
  totalDurationMinutes: z.number().int().positive(),
  confirmedAt: z.string().datetime().optional(),
  confirmedBy: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;

// ─── Transcript Line ───
export const TranscriptLineSchema = z.object({
  id: UuidSchema.optional(),
  interviewId: z.string(),
  sourceType: z.nativeEnum(TranscriptSource),
  platformSentenceId: z.string().optional(),
  dedupKey: z.string().optional(),
  speakerPlatformId: z.string().optional(),
  speakerDisplayName: z.string(),
  speakerRole: z.nativeEnum(SpeakerRole).default(SpeakerRole.Unknown),
  roleSource: z.nativeEnum(RoleSource).default(RoleSource.Unknown),
  text: z.string(),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime().optional(),
  revision: z.number().int().positive().default(1),
  contentHash: z.string().optional(),
  isDeleted: z.boolean().default(false),
});

export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;

// ─── Evidence Ref ───
export const EvidenceRefSchema = z.object({
  sourceType: z.enum(["transcript", "resume", "jd"]),
  sourceId: z.string().min(1),
  sourceRevision: z.number().int().positive(),
  quote: z.string().min(1),
  speakerRole: z.nativeEnum(SpeakerRole).optional(),
  occurredAt: z.string().datetime().optional(),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

// ─── Review Conclusion ───
export const ReviewConclusionSchema = z.object({
  id: UuidSchema.optional(),
  dimension: z.string().min(1),
  contentType: z.nativeEnum(ContentType),
  text: z.string().min(1),
  evidenceRefs: z.array(EvidenceRefSchema).min(1),
  aiGenerated: z.boolean().default(true),
  humanEdited: z.boolean().default(false),
});

export type ReviewConclusion = z.infer<typeof ReviewConclusionSchema>;

// ─── Review Draft ───
export const ReviewDraftSchema = z.object({
  id: UuidSchema.optional(),
  interviewId: z.string(),
  revision: z.number().int().positive().default(1),
  overview: z.string().optional(),
  conclusions: z.array(ReviewConclusionSchema).default([]),
  strengths: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  uncoveredTopics: z.array(z.string()).default([]),
  nextRoundFocus: z.array(z.string()).default([]),
  suggestedDecision: z.nativeEnum(HumanDecision).optional(),
  humanDecision: z.nativeEnum(HumanDecision).optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type ReviewDraft = z.infer<typeof ReviewDraftSchema>;

// ─── Live Suggestion ───
export const LiveSuggestionSchema = z.object({
  id: UuidSchema.optional(),
  interviewId: z.string(),
  kind: z.nativeEnum(SuggestionKind),
  topicId: z.string().optional(),
  observation: z.string().min(1),
  suggestedQuestion: z.string().optional(),
  evidenceLineIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  generation: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  feedback: z.enum(["useful", "useless", "already_asked", "wrong_evidence", "should_not_remind"]).optional(),
});

export type LiveSuggestion = z.infer<typeof LiveSuggestionSchema>;

// ─── Interview Package (Import) ───
const SafeExternalIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/, "must be a safe opaque identifier");

export const InterviewPackageSchema = z.object({
  schemaVersion: z.literal("1.0"),
  idempotencyKey: z.string().trim().min(12).max(200),
  candidateKey: SafeExternalIdSchema,
  applicationKey: SafeExternalIdSchema,
  jobKey: SafeExternalIdSchema,
  interviewId: SafeExternalIdSchema,
  round: z.string().trim().min(1).max(80),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(480),
  interviewers: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    feishuOpenId: z.string().trim().min(1).max(160).optional(),
  })).min(1).max(20),
  feishuEventId: z.string().optional(),
  meetingUrl: z.string().optional(),
  job: z.object({
    title: z.string().trim().min(1).max(300),
    jdText: z.string().max(100_000),
    internalCriteria: z.array(z.string().trim().min(1).max(2000)).max(50),
    dimensions: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
    policyVersion: z.string().optional(),
  }),
  candidate: z.object({
    displayName: z.string().trim().min(1).max(120),
    resumeText: z.string().max(200_000).optional(),
    resumeHash: z.string().optional(),
  }),
  screening: z.object({
    rating: z.string().optional(),
    strengths: z.array(z.string().max(2000)).max(50).default([]),
    verificationPoints: z.array(z.string().max(2000)).max(50).default([]),
    sourceNotes: z.array(z.string().max(2000)).max(100).default([]),
  }),
  previousRounds: z.array(z.object({
    round: z.string(),
    summary: z.string(),
    verified: z.array(z.string()).default([]),
    unverified: z.array(z.string()).default([]),
  })).max(20).default([]),
}).strict();

export type InterviewPackage = z.infer<typeof InterviewPackageSchema>;

// ─── Interview Result Package (Export) ───
export const InterviewResultPackageSchema = z.object({
  schemaVersion: z.literal("1.0"),
  interviewId: z.string(),
  candidateKey: z.string(),
  jobKey: z.string(),
  reviewStatus: z.literal("approved"),
  approvedBy: z.string(),
  approvedAt: z.string().datetime(),
  dimensionReviews: z.array(z.object({
    dimension: z.string(),
    summary: z.string(),
    evidenceRefs: z.array(EvidenceRefSchema),
  })),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  openQuestions: z.array(z.string()),
  humanDecision: z.nativeEnum(HumanDecision),
  nextRoundFocus: z.array(z.string()),
  evidenceManifest: z.array(z.object({
    lineId: z.string(),
    sourceType: z.nativeEnum(TranscriptSource),
    quotePreview: z.string(),
  })),
  sourceRevision: z.number().int().positive(),
});

export type InterviewResultPackage = z.infer<typeof InterviewResultPackageSchema>;

// ─── SSE Event Types ───
export const SseEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("transcript.line.upserted"), id: z.string(), data: TranscriptLineSchema }),
  z.object({ event: z.literal("topic.coverage.updated"), data: z.object({ topicId: z.string(), status: z.nativeEnum(TopicStatus) }) }),
  z.object({ event: z.literal("live.suggestion.created"), data: LiveSuggestionSchema }),
  z.object({ event: z.literal("interview.status.changed"), data: z.object({ interviewId: z.string(), status: z.nativeEnum(InterviewStatus) }) }),
  z.object({ event: z.literal("review.draft.ready"), data: z.object({ interviewId: z.string(), revision: z.number() }) }),
]);

export type SseEvent = z.infer<typeof SseEventSchema>;
