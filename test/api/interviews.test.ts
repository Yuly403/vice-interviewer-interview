import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vice/database";
import { InterviewStatus as IS } from "@vice/contracts";

const TEST_PREFIX = "int-test-crud";
const IDS = Array.from({ length: 5 }, (_, i) => `${TEST_PREFIX}-${String(i + 1).padStart(2, "0")}`);

describe("API Integration: Interview CRUD", () => {
  beforeAll(async () => {
    // Create test interviews spanning different statuses
    const now = new Date();
    for (let i = 0; i < IDS.length; i++) {
      const statuses = [IS.Created, IS.PackageImported, IS.Ready, IS.Live, IS.Closed];
      await prisma.interview.upsert({
        where: { id: IDS[i] },
        create: {
          id: IDS[i],
          applicationId: `app-test-${i + 1}`,
          roundType: i < 4 ? "first_round" : "final_round",
          scheduledAt: new Date(now.getTime() + i * 3600_000),
          durationMinutes: 45 + i * 15,
          status: statuses[i],
          packageRevision: 1,
        },
        update: { status: statuses[i] },
      });

      // Add participants
      await prisma.interviewParticipant.upsert({
        where: { interviewId_userId: { interviewId: IDS[i], userId: `u-crud-${i}` } },
        create: {
          interviewId: IDS[i],
          userId: `u-crud-${i}`,
          displayName: `面试官${i + 1}`,
          role: "interviewer",
          roleSource: "user",
        },
        update: {},
      });

      await prisma.interviewParticipant.upsert({
        where: { interviewId_userId: { interviewId: IDS[i], userId: `candidate-${i}` } },
        create: {
          interviewId: IDS[i],
          userId: `candidate-${i}`,
          displayName: `候选人${String.fromCharCode(65 + i)}`,
          role: "candidate",
          roleSource: "user",
        },
        update: {},
      });
    }
  });

  afterAll(async () => {
    for (const id of IDS) {
      await prisma.interviewParticipant.deleteMany({ where: { interviewId: id } });
      await prisma.transcriptLine.deleteMany({ where: { interviewId: id } });
      await prisma.reviewDraft.deleteMany({ where: { interviewId: id } });
    }
    await prisma.interview.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  describe("GET /interviews — list all", () => {
    it("should return all interviews with participants", async () => {
      const interviews = await prisma.interview.findMany({
        where: { id: { startsWith: TEST_PREFIX } },
        include: { participants: true },
        orderBy: { scheduledAt: "desc" },
      });

      expect(interviews.length).toBeGreaterThanOrEqual(IDS.length);

      // Verify structure
      const first = interviews[0];
      expect(first.id).toBeDefined();
      expect(first.status).toBeDefined();
      expect(first.participants.length).toBeGreaterThanOrEqual(2);
      expect(first.participants.some((p) => p.role === "candidate")).toBe(true);
      expect(first.participants.some((p) => p.role === "interviewer")).toBe(true);
    });

    it("should return interviews in descending order by scheduledAt", async () => {
      const interviews = await prisma.interview.findMany({
        where: { id: { startsWith: TEST_PREFIX } },
        orderBy: { scheduledAt: "desc" },
      });

      for (let i = 1; i < interviews.length; i++) {
        expect(
          new Date(interviews[i - 1].scheduledAt).getTime()
        ).toBeGreaterThanOrEqual(
          new Date(interviews[i].scheduledAt).getTime()
        );
      }
    });
  });

  describe("GET /interviews/:id — single interview", () => {
    it("should return interview with full details", async () => {
      const interview = await prisma.interview.findUnique({
        where: { id: IDS[0] },
        include: {
          participants: true,
          plan: { include: { topics: { include: { criteria: true }, orderBy: { sortOrder: "asc" } } } },
          reviewDrafts: { orderBy: { revision: "desc" }, take: 1 },
          captureLease: true,
        },
      });

      expect(interview).not.toBeNull();
      expect(interview!.id).toBe(IDS[0]);
      expect(interview!.status).toBe(IS.Created);
      expect(interview!.applicationId).toBe("app-test-1");
      expect(interview!.roundType).toBe("first_round");
      expect(interview!.durationMinutes).toBe(45);
      expect(interview!.participants.length).toBeGreaterThanOrEqual(2);
    });

    it("should return null for non-existent interview", async () => {
      const interview = await prisma.interview.findUnique({
        where: { id: "non-existent-id" },
      });
      expect(interview).toBeNull();
    });
  });

  describe("POST /interviews/import — upsert interview package", () => {
    const IMPORT_ID = `${TEST_PREFIX}-import`;

    afterAll(async () => {
      await prisma.interviewParticipant.deleteMany({ where: { interviewId: IMPORT_ID } });
      await prisma.interview.deleteMany({ where: { id: IMPORT_ID } });
    });

    it("should create a new interview via upsert", async () => {
      const interview = await prisma.interview.upsert({
        where: { id: IMPORT_ID },
        create: {
          id: IMPORT_ID,
          applicationId: "app-import",
          roundType: "second_round",
          scheduledAt: new Date(),
          durationMinutes: 60,
          status: "package_imported",
          packageRevision: 1,
        },
        update: { status: "package_imported" },
      });

      expect(interview).toBeDefined();
      expect(interview.id).toBe(IMPORT_ID);
      expect(interview.status).toBe("package_imported");

      // Verify in DB
      const found = await prisma.interview.findUnique({ where: { id: IMPORT_ID } });
      expect(found).not.toBeNull();
      expect(found!.applicationId).toBe("app-import");
    });

    it("should update existing interview on re-import", async () => {
      const updated = await prisma.interview.upsert({
        where: { id: IMPORT_ID },
        create: { id: IMPORT_ID, applicationId: "app-import", roundType: "second_round", scheduledAt: new Date(), durationMinutes: 60, status: "package_imported", packageRevision: 1 },
        update: { status: "package_imported", packageRevision: { increment: 1 } },
      });

      expect(updated.packageRevision).toBe(2);
    });

    it("should create participants with correct role", async () => {
      const participants = await prisma.interviewParticipant.createMany({
        data: [
          { interviewId: IMPORT_ID, userId: "u-import-1", displayName: "面试官甲", role: "interviewer", roleSource: "user" },
          { interviewId: IMPORT_ID, displayName: "候选人甲", role: "candidate", roleSource: "user" },
        ],
      });

      expect(participants.count).toBe(2);
    });

    it("should enforce unique constraint on interviewId + userId", async () => {
      await expect(
        prisma.interviewParticipant.create({
          data: { interviewId: IMPORT_ID, userId: "u-import-1", displayName: "duplicate", role: "interviewer", roleSource: "user" },
        })
      ).rejects.toThrow();
    });
  });

  describe("Status field integrity", () => {
    it("should store and retrieve status correctly", async () => {
      const all = await prisma.interview.findMany({
        where: { id: { startsWith: TEST_PREFIX } },
        select: { id: true, status: true },
      });

      const statusMap = new Map(all.map((i) => [i.id, i.status]));
      expect(statusMap.get(IDS[0])).toBe(IS.Created);
      expect(statusMap.get(IDS[3])).toBe(IS.Live);
      expect(statusMap.get(IDS[4])).toBe(IS.Closed);
    });

    it("should handle JSON fields correctly", async () => {
      // Test ledger transitions JSON storage
      const transitions = [
        { from: "not_set", to: "pass", at: new Date().toISOString(), rule: "pass_first_round" },
      ];

      await prisma.interview.update({
        where: { id: IDS[0] },
        data: {
          ledgerStatus: "pass",
          ledgerTransitions: JSON.stringify(transitions),
        },
      });

      const loaded = await prisma.interview.findUnique({ where: { id: IDS[0] } });
      expect(loaded!.ledgerStatus).toBe("pass");
      const parsed = JSON.parse(loaded!.ledgerTransitions);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].rule).toBe("pass_first_round");
    });
  });
});
