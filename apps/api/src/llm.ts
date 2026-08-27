import type { LlmConfig } from "@vice/llm";

export function getLlmConfig(): LlmConfig {
  return {
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://llm-gateway.example.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    timeoutSec: Number(process.env.LLM_TIMEOUT_SEC || 25),
    temperature: 0.1,
  };
}

/** Quick check: is the LLM configured? */
export function isLlmConfigured(): boolean {
  return !!(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_BASE_URL);
}
