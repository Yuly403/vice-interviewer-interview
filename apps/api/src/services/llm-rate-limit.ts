import type { FastifyReply, FastifyRequest } from "fastify";
import type { RequestUser } from "../plugins/auth.js";

interface Bucket {
  startedAt: number;
  count: number;
}

const buckets = new Map<string, Bucket>();
const USER_LIMIT = 10;
const USER_WINDOW_MS = 10 * 60_000;
const INTERVIEW_LIMIT = 4;
const INTERVIEW_WINDOW_MS = 5 * 60_000;
const MAX_BUCKETS = 10_000;

function consume(key: string, limit: number, windowMs: number, now = Date.now()) {
  const existing = buckets.get(key);
  if (!existing || now - existing.startedAt >= windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.startedAt + windowMs - now) / 1000)),
    };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function prune(now = Date.now()): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= USER_WINDOW_MS) buckets.delete(key);
  }
}

/** Basic cost guard for the single-API production topology. */
export function enforceLlmRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  action: "plan" | "review",
  interviewId: string,
): boolean {
  const user = req.user as RequestUser | undefined;
  const principal = user?.userId ?? "anonymous";
  const userResult = consume(`llm:user:${principal}`, USER_LIMIT, USER_WINDOW_MS);
  prune();
  if (!userResult.allowed) {
    sendLimited(reply, userResult.retryAfterSec);
    return false;
  }

  const interviewResult = consume(`llm:${action}:interview:${interviewId}`, INTERVIEW_LIMIT, INTERVIEW_WINDOW_MS);
  if (interviewResult.allowed) return true;

  sendLimited(reply, interviewResult.retryAfterSec);
  return false;
}

function sendLimited(reply: FastifyReply, retryAfterSec: number): void {
  reply.header("Retry-After", String(retryAfterSec));
  reply.status(429).send({
    code: "LLM_RATE_LIMITED",
    message: "Too many AI generation requests; wait before trying again",
    retryAfterSec,
  });
}

export function resetLlmRateLimitsForTests(): void {
  buckets.clear();
}
