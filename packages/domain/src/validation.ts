import {
  type EvidenceRef,
  type ReviewConclusion,
  type TranscriptLine,
  ContentType,
  SpeakerRole,
} from "@vice/contracts";

// ─── Evidence Validation ───
export interface EvidenceValidationResult {
  valid: boolean;
  errors: EvidenceError[];
}

export interface EvidenceError {
  ref: EvidenceRef;
  code: string;
  message: string;
}

export function validateEvidenceRefs(
  refs: EvidenceRef[],
  transcriptLines: TranscriptLine[],
  allowedRole: SpeakerRole = SpeakerRole.Candidate
): EvidenceValidationResult {
  const errors: EvidenceError[] = [];
  const lineMap = new Map(transcriptLines.map((l) => [l.id, l]));

  for (const ref of refs) {
    if (!ref.sourceId) {
      errors.push({ ref, code: "MISSING_SOURCE_ID", message: "sourceId is required" });
      continue;
    }

    const line = lineMap.get(ref.sourceId);
    if (!line) {
      errors.push({ ref, code: "SOURCE_NOT_FOUND", message: `Line ${ref.sourceId} not found` });
      continue;
    }

    if (line.isDeleted) {
      errors.push({ ref, code: "SOURCE_DELETED", message: `Line ${ref.sourceId} is deleted` });
      continue;
    }

    const normalizedQuote = ref.quote.replace(/\s+/g, "").toLowerCase();
    const normalizedText = line.text.replace(/\s+/g, "").toLowerCase();
    if (!normalizedText.includes(normalizedQuote)) {
      errors.push({ ref, code: "QUOTE_MISMATCH", message: "Quote is not a substring of transcript text" });
      continue;
    }

    if (allowedRole !== SpeakerRole.Unknown && line.speakerRole !== allowedRole) {
      errors.push({
        ref,
        code: "ROLE_MISMATCH",
        message: `Expected ${allowedRole} but got ${line.speakerRole}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Review Conclusion Validation ───
export function validateReviewConclusion(
  conclusion: ReviewConclusion,
  transcriptLines: TranscriptLine[]
): EvidenceValidationResult {
  if (conclusion.contentType === ContentType.HumanDecision) {
    return { valid: true, errors: [] };
  }

  if (conclusion.evidenceRefs.length === 0) {
    return {
      valid: false,
      errors: [{
        ref: { sourceType: "transcript", sourceId: "", sourceRevision: 0, quote: "" },
        code: "NO_EVIDENCE",
        message: `Conclusion '${conclusion.text.slice(0, 50)}...' has no evidence refs`,
      }],
    };
  }

  // A factual or inferential conclusion must be supported by a statement
  // attributable to the candidate, not merely by an interviewer prompt.
  if (conclusion.evidenceRefs.some((ref) => ref.sourceType !== "transcript")) {
    return {
      valid: false,
      errors: conclusion.evidenceRefs
        .filter((ref) => ref.sourceType !== "transcript")
        .map((ref) => ({
          ref,
          code: "UNSUPPORTED_EVIDENCE_SOURCE",
          message: "Review conclusions require transcript evidence",
        })),
    };
  }

  return validateEvidenceRefs(conclusion.evidenceRefs, transcriptLines, SpeakerRole.Candidate);
}

// ─── Transcript Dedup ───
export function computeDedupKey(line: { speakerDisplayName: string; text: string; occurredAt: string }): string {
  const normalized = line.text.replace(/\s+/g, "").toLowerCase();
  return `${line.speakerDisplayName}::${line.occurredAt}::${normalized}`;
}

export function shouldUpsert(
  existing: TranscriptLine | undefined,
  incoming: TranscriptLine
): { action: "skip" | "upsert"; reason: string } {
  if (!existing) return { action: "upsert", reason: "new" };

  if (existing.isDeleted) return { action: "skip", reason: "deleted" };

  const incomingLen = incoming.text.length;
  const existingLen = existing.text.length;

  if (incomingLen > existingLen) {
    return { action: "upsert", reason: "text_expanded" };
  }

  if (incomingLen === existingLen && incoming.text !== existing.text) {
    return { action: "upsert", reason: "text_corrected" };
  }

  return { action: "skip", reason: "unchanged" };
}

// ─── Coverage Engine ───
export function computeTopicCoverage(topic: {
  criteria: Array<{ status: string; evidenceLineIds: string[] }>;
}): {
  coveragePercent: number;
  isCovered: boolean;
  hasGaps: boolean;
} {
  const total = topic.criteria.length;
  if (total === 0) return { coveragePercent: 0, isCovered: false, hasGaps: true };

  const supported = topic.criteria.filter((c) => c.status === "supported").length;
  const coveragePercent = Math.round((supported / total) * 100);

  return {
    coveragePercent,
    isCovered: supported === total,
    hasGaps: supported < total,
  };
}

// ─── Reminder Budget ───
export class ReminderBudget {
  private used = 0;
  private topicCooldowns = new Map<string, number>();

  constructor(
    public readonly maxReminders: number = 5,
    public readonly cooldownMs: number = 5 * 60 * 1000
  ) {}

  canRemind(topicId: string, now: number = Date.now()): boolean {
    if (this.used >= this.maxReminders) return false;
    const last = this.topicCooldowns.get(topicId);
    if (last && now - last < this.cooldownMs) return false;
    return true;
  }

  consume(topicId: string, now: number = Date.now()): void {
    this.used++;
    this.topicCooldowns.set(topicId, now);
  }

  remaining(): number {
    return Math.max(0, this.maxReminders - this.used);
  }

  reset(): void {
    this.used = 0;
    this.topicCooldowns.clear();
  }
}
