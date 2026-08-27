import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vice/database";
import { TranscriptLineSchema } from "@vice/contracts";
import { shouldUpsert, computeDedupKey } from "@vice/domain";
import { InterviewStatus as IS } from "@vice/contracts";

const INTERVIEW_ID = "int-test-transcripts-001";

describe("API Integration: Transcript flow", () => {
  beforeAll(async () => {
    await prisma.interview.upsert({
      where: { id: INTERVIEW_ID },
      create: {
        id: INTERVIEW_ID,
        applicationId: "app-transcript-test",
        roundType: "first_round",
        scheduledAt: new Date(),
        durationMinutes: 60,
        status: IS.Live,
        packageRevision: 1,
      },
      update: { status: IS.Live },
    });
  });

  afterAll(async () => {
    await prisma.transcriptLineRevision.deleteMany({ where: { line: { interviewId: INTERVIEW_ID } } });
    await prisma.transcriptLine.deleteMany({ where: { interviewId: INTERVIEW_ID } });
    await prisma.interview.deleteMany({ where: { id: INTERVIEW_ID } });
    await prisma.$disconnect();
  });

  describe("Transcript line import", () => {
    it("should import new transcript lines", async () => {
      const lines = [
        {
          interviewId: INTERVIEW_ID,
          sourceType: "manual",
          platformSentenceId: "sent-t-001",
          speakerDisplayName: "面试官A",
          speakerRole: "interviewer",
          roleSource: "user",
          text: "请做一下自我介绍。",
          occurredAt: new Date(),
        },
        {
          interviewId: INTERVIEW_ID,
          sourceType: "manual",
          platformSentenceId: "sent-t-002",
          speakerDisplayName: "候选人王",
          speakerRole: "candidate",
          roleSource: "user",
          text: "我有八年后端开发经验。",
          occurredAt: new Date(),
        },
      ];

      for (const line of lines) {
        await prisma.transcriptLine.create({ data: line });
      }

      const loaded = await prisma.transcriptLine.findMany({
        where: { interviewId: INTERVIEW_ID },
        orderBy: { occurredAt: "asc" },
      });

      expect(loaded).toHaveLength(2);
      expect(loaded[0].platformSentenceId).toBe("sent-t-001");
      expect(loaded[0].speakerRole).toBe("interviewer");
      expect(loaded[1].speakerRole).toBe("candidate");
    });

    it("should validate transcript line schema", () => {
      const valid = TranscriptLineSchema.safeParse({
        interviewId: INTERVIEW_ID,
        sourceType: "manual",
        platformSentenceId: "sent-t-003",
        speakerDisplayName: "候选人王",
        speakerRole: "candidate",
        text: "Valid line",
        occurredAt: new Date().toISOString(),
      });
      expect(valid.success).toBe(true);

      const invalid = TranscriptLineSchema.safeParse({
        interviewId: INTERVIEW_ID,
        sourceType: "manual",
        // Missing platformSentenceId
        speakerRole: "candidate",
        text: "",
        occurredAt: "not-a-date",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("Transcript dedup and upsert", () => {
    it("should detect duplicate lines via platformSentenceId", async () => {
      const existing = await prisma.transcriptLine.findUnique({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId: INTERVIEW_ID,
            sourceType: "manual",
            platformSentenceId: "sent-t-001",
          },
        },
      });

      expect(existing).not.toBeNull();
    });

    it("should skip identical content via shouldUpsert", async () => {
      const existing = await prisma.transcriptLine.findUnique({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId: INTERVIEW_ID,
            sourceType: "manual",
            platformSentenceId: "sent-t-001",
          },
        },
      });

      const newLine = {
        ...existing!,
        text: existing!.text, // Same content
        contentHash: computeDedupKey({
          speakerDisplayName: existing!.speakerDisplayName,
          text: existing!.text,
          occurredAt: existing!.occurredAt.toISOString(),
        }),
      };

      const decision = shouldUpsert(existing as any, newLine as any);
      expect(decision.action).toBe("skip");
    });

    it("should update when content differs", async () => {
      const existing = await prisma.transcriptLine.findUnique({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId: INTERVIEW_ID,
            sourceType: "manual",
            platformSentenceId: "sent-t-002",
          },
        },
      });

      const newLine = {
        ...existing!,
        text: "我有八年后端开发经验，目前在一家虚构软件公司负责后端架构。", // Different content
        contentHash: "different",
      };

      const decision = shouldUpsert(existing as any, newLine as any);
      // shouldUpsert returns "upsert" for both expanded and corrected text
      expect(decision.action).toBe("upsert");
    });
  });

  describe("Transcript line filtering", () => {
    it("should filter by speaker role", async () => {
      const candidateLines = await prisma.transcriptLine.findMany({
        where: {
          interviewId: INTERVIEW_ID,
          speakerRole: "candidate",
          isDeleted: false,
        },
        orderBy: { occurredAt: "asc" },
      });

      expect(candidateLines.length).toBeGreaterThanOrEqual(1);
      candidateLines.forEach((l) => {
        expect(l.speakerRole).toBe("candidate");
      });
    });

    it("should exclude deleted lines", async () => {
      // Soft-delete a line
      await prisma.transcriptLine.update({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId: INTERVIEW_ID,
            sourceType: "manual",
            platformSentenceId: "sent-t-001",
          },
        },
        data: { isDeleted: true },
      });

      const active = await prisma.transcriptLine.findMany({
        where: { interviewId: INTERVIEW_ID, isDeleted: false },
      });

      expect(active.length).toBe(1);
      expect(active[0].platformSentenceId).toBe("sent-t-002");

      // Restore
      await prisma.transcriptLine.update({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId: INTERVIEW_ID,
            sourceType: "manual",
            platformSentenceId: "sent-t-001",
          },
        },
        data: { isDeleted: false },
      });
    });
  });

  describe("Transcript line editing with revision history", () => {
    it("should save revision on text change", async () => {
      const line = await prisma.transcriptLine.findUnique({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId: INTERVIEW_ID,
            sourceType: "manual",
            platformSentenceId: "sent-t-001",
          },
        },
      });

      const oldText = line!.text;
      const newText = "请介绍一下你的工作经历和技术栈。";

      // Save revision
      await prisma.transcriptLineRevision.create({
        data: {
          lineId: line!.id,
          oldText,
          newText,
          modifiedBy: "user",
        },
      });

      // Update line
      await prisma.transcriptLine.update({
        where: { id: line!.id },
        data: {
          text: newText,
          revision: { increment: 1 },
        },
      });

      // Verify revision saved
      const revisions = await prisma.transcriptLineRevision.findMany({
        where: { lineId: line!.id },
      });

      expect(revisions).toHaveLength(1);
      expect(revisions[0].oldText).toBe(oldText);
      expect(revisions[0].newText).toBe(newText);
      expect(revisions[0].modifiedBy).toBe("user");
    });

    it("should increment line revision after edit", async () => {
      const line = await prisma.transcriptLine.findUnique({
        where: {
          interviewId_sourceType_platformSentenceId: {
            interviewId: INTERVIEW_ID,
            sourceType: "manual",
            platformSentenceId: "sent-t-001",
          },
        },
      });

      expect(line!.revision).toBeGreaterThanOrEqual(2); // Initial + update
    });
  });

  describe("Transcript count and statistics", () => {
    it("should count total transcript lines", async () => {
      const count = await prisma.transcriptLine.count({
        where: { interviewId: INTERVIEW_ID, isDeleted: false },
      });

      expect(count).toBeGreaterThanOrEqual(2);
    });

    it("should count by speaker role", async () => {
      const interviewerCount = await prisma.transcriptLine.count({
        where: { interviewId: INTERVIEW_ID, isDeleted: false, speakerRole: "interviewer" },
      });
      const candidateCount = await prisma.transcriptLine.count({
        where: { interviewId: INTERVIEW_ID, isDeleted: false, speakerRole: "candidate" },
      });

      expect(interviewerCount + candidateCount).toBeGreaterThanOrEqual(2);
    });
  });
});
