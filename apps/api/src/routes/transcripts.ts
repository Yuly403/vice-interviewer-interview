import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { SpeakerRole, TranscriptLineSchema } from "@vice/contracts";
import { shouldUpsert } from "@vice/domain";

const TranscriptLineUpdateSchema = z.object({
  text: z.string().trim().min(1).max(20_000).optional(),
  speakerRole: z.nativeEnum(SpeakerRole).optional(),
}).strict().refine((value) => value.text !== undefined || value.speakerRole !== undefined, {
  message: "At least one editable field is required",
});

export const transcriptRoutes: FastifyPluginAsync = async (app) => {
  // Get transcript lines
  app.get<{ Params: { id: string }; Querystring: { afterSeq?: string; speaker?: string } }>(
    "/interviews/:id/transcript",
    async (req) => {
      const where: any = { interviewId: req.params.id, isDeleted: false };
      if (req.query.speaker) where.speakerRole = req.query.speaker;

      const lines = await prisma.transcriptLine.findMany({
        where,
        orderBy: { occurredAt: "asc" },
      });

      return { data: lines, total: lines.length };
    }
  );

  // Import transcript lines (manual / batch)
  app.post<{ Params: { id: string } }>("/interviews/:id/transcript/import", async (req) => {
    const body = req.body as any;
    const lines = body.lines || [];
    const imported: string[] = [];
    const skipped: string[] = [];

    for (const raw of lines) {
      const parsed = TranscriptLineSchema.safeParse({ ...raw, interviewId: req.params.id });
      if (!parsed.success) {
        skipped.push(`Validation: ${parsed.error.message}`);
        continue;
      }

      const line = parsed.data;

      // Check existing for dedup
      const existing = line.platformSentenceId
        ? await prisma.transcriptLine.findUnique({
            where: {
              interviewId_sourceType_platformSentenceId: {
                interviewId: req.params.id,
                sourceType: line.sourceType,
                platformSentenceId: line.platformSentenceId,
              },
            },
          })
        : null;

      const decision = shouldUpsert(existing as any, line as any);

      if (decision.action === "skip") {
        skipped.push(`${line.platformSentenceId || "unknown"}: ${decision.reason}`);
        continue;
      }

      if (existing) {
        await prisma.transcriptLine.update({
          where: { id: existing.id },
          data: {
            text: line.text,
            revision: { increment: 1 },
            contentHash: line.contentHash,
          },
        });
      } else {
        await prisma.transcriptLine.create({ data: line as any });
      }
      imported.push(line.platformSentenceId || line.id || "new");
    }

    // Update transcript revision
    await prisma.interview.update({
      where: { id: req.params.id },
      data: { transcriptRevision: { increment: 1 } },
    });

    return { data: { imported, skipped }, message: `Imported ${imported.length}, skipped ${skipped.length}` };
  });

  // Update single transcript line
  app.patch<{ Params: { id: string; lineId: string } }>(
    "/interviews/:id/transcript/lines/:lineId",
    async (req, reply) => {
      const parsed = TranscriptLineUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "INVALID_TRANSCRIPT_UPDATE",
          message: "Transcript update failed validation",
          details: parsed.error.flatten(),
        });
      }
      const body = parsed.data;
      const line = await prisma.transcriptLine.findFirst({
        where: { id: req.params.lineId, interviewId: req.params.id },
      });

      if (!line) {
        return reply.status(404).send({ code: "TRANSCRIPT_LINE_NOT_FOUND", message: "Transcript line not found in this interview" });
      }

      const textChanged = body.text !== undefined && body.text !== line.text;
      const roleChanged = body.speakerRole !== undefined && body.speakerRole !== line.speakerRole;
      if (!textChanged && !roleChanged) {
        return { data: line, idempotent: true };
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (textChanged && body.text !== undefined) {
          await tx.transcriptLineRevision.create({
            data: {
              lineId: line.id,
              oldText: line.text,
              newText: body.text,
              modifiedBy: req.user?.userId ?? "user",
            },
          });
        }

        return tx.transcriptLine.update({
          where: { id: line.id },
          data: {
            ...(textChanged && body.text !== undefined ? { text: body.text } : {}),
            ...(roleChanged && body.speakerRole !== undefined
              ? { speakerRole: body.speakerRole, roleSource: "user" }
              : {}),
            revision: { increment: 1 },
          },
        });
      });

      return { data: updated };
    }
  );
};
