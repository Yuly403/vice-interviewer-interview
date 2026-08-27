import { z, ZodError } from "zod";

export const PLAN_PROMPT_VERSION = "plan-v2-secure-json";
export const REVIEW_PROMPT_VERSION = "review-v2-secure-evidence-json";

export const PlanGenerationModeSchema = z.enum(["llm", "rule-based"]);
export type PlanGenerationMode = z.infer<typeof PlanGenerationModeSchema>;

export const LlmFailureReasonSchema = z.enum([
  "not_configured",
  "timeout",
  "api_error",
  "invalid_json",
  "invalid_schema",
  "empty_output",
  "unknown",
]);
export type LlmFailureReason = z.infer<typeof LlmFailureReasonSchema>;

export const PlanGenerationMetaSchema = z.object({
  mode: PlanGenerationModeSchema,
  model: z.string().trim().min(1).max(200).nullable(),
  promptVersion: z.string().trim().min(1).max(100),
  durationMs: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().optional(),
  fallbackReason: LlmFailureReasonSchema.optional(),
  generatedAt: z.string().datetime(),
}).strict();

export type PlanGenerationMeta = z.infer<typeof PlanGenerationMetaSchema>;

export function classifyLlmFailure(error: unknown): LlmFailureReason {
  if (error instanceof ZodError) return "invalid_schema";
  if (error instanceof SyntaxError) return "invalid_json";

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("aborted")) return "timeout";
  if (message.includes("not valid json") || message.includes("json")) return "invalid_json";
  if (
    message.includes("api error") ||
    message.includes("http") ||
    message.includes("socket") ||
    message.includes("econn") ||
    message.includes("enotfound") ||
    message.includes("certificate") ||
    message.includes("tls")
  ) return "api_error";
  if (message.includes("empty output") || message.includes("empty content")) return "empty_output";
  return "unknown";
}

export function parsePlanGenerationMeta(raw: string | null | undefined): PlanGenerationMeta | null {
  if (!raw) return null;
  try {
    const parsed = PlanGenerationMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
