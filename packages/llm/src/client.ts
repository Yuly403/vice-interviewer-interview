/**
 * OpenAI-compatible chat-completions client over HTTPS.
 *
 * Private gateways may use an internal CA certificate. Inject the CA bundle;
 * do not disable TLS verification.
 */

import https from "node:https";
import fs from "node:fs";
import { z } from "zod";

// ---- config ----------------------------------------------------------------

export interface LlmConfig {
  baseUrl: string;        // e.g. https://llm-gateway.example.com/v1
  apiKey: string;
  model: string;          // deepseek-v4-pro | deepseek-v4-flash
  /** Seconds before the fetch aborts. Default 180. */
  timeoutSec?: number;
  /** Temperature 0-2. Default 0 for deterministic output. */
  temperature?: number;
  /** PEM CA bundle for a private model gateway; standard verification remains on. */
  caCertPath?: string;
}

// ---- low-level fetch -------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string;
    };
    finish_reason: "stop" | "length" | "content_filter" | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const ChatCompletionResponseSchema = z.object({
  id: z.string().optional().default(""),
  object: z.string().optional().default("chat.completion"),
  model: z.string().min(1),
  choices: z.array(z.object({
    index: z.number().int(),
    message: z.object({
      role: z.string(),
      content: z.string().nullable(),
      reasoning_content: z.string().optional(),
    }).passthrough(),
    finish_reason: z.string().nullable(),
  }).passthrough()).min(1).max(16),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }).optional(),
}).passthrough();

const MAX_LLM_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOKENS = 4_096;
const ABSOLUTE_MAX_TOKENS = 8_192;

export interface ChatResult {
  content: string;
  reasoningContent?: string;
  finishReason: string | null;
  usage?: ChatCompletionResponse["usage"];
}

function fetchChatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  maxTokens?: number,
): Promise<ChatCompletionResponse> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const u = new URL(url);
  if (u.protocol !== "https:") {
    return Promise.reject(new Error("LLM endpoint must use HTTPS"));
  }
  const boundedMaxTokens = Math.min(Math.max(maxTokens ?? DEFAULT_MAX_TOKENS, 1), ABSOLUTE_MAX_TOKENS);
  const body = JSON.stringify({
    model: config.model,
    messages,
    temperature: config.temperature ?? 0,
    max_tokens: boundedMaxTokens,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const caCertPath = config.caCertPath ?? process.env.LLM_CA_CERT_PATH;
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        method: "POST",
        // Never disable TLS verification. Private gateways must supply their CA
        // bundle through LLM_CA_CERT_PATH instead.
        rejectUnauthorized: true,
        ...(caCertPath ? { ca: fs.readFileSync(caCertPath) } : {}),
        timeout: (config.timeoutSec ?? 180) * 1000,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let responseBytes = 0;
        res.on("data", (chunk: Buffer) => {
          responseBytes += chunk.length;
          if (responseBytes > MAX_LLM_RESPONSE_BYTES) {
            fail(new Error("LLM response exceeded the maximum allowed size"));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", (error) => fail(error));
        res.on("end", () => {
          if (settled) return;
          const raw = Buffer.concat(chunks).toString("utf-8");
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return fail(new Error(`LLM API returned HTTP ${res.statusCode ?? "unknown"}`));
          }
          try {
            const json = JSON.parse(raw) as unknown;
            if ((json as any).error) {
              return fail(new Error("LLM API returned an error response"));
            }
            const parsed = ChatCompletionResponseSchema.safeParse(json);
            if (!parsed.success) return fail(new Error("LLM response envelope failed validation"));
            settled = true;
            resolve(parsed.data as ChatCompletionResponse);
          } catch {
            // Model output may contain a candidate transcript. Do not echo it
            // into logs or error responses.
            fail(new Error("LLM response was not valid JSON"));
          }
        });
      },
    );
    req.on("error", (error) => fail(error));
    req.on("timeout", () => {
      req.destroy();
      fail(new Error("LLM request timeout"));
    });
    req.write(body);
    req.end();
  });
}

// ---- public API ------------------------------------------------------------

/**
 * Send a chat completion request and return the consolidated response.
 * Automatically falls back to reasoning_content when content is empty
 * (Some reasoning models may output only reasoning_content).
 */
export async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
  maxTokens?: number,
): Promise<ChatResult> {
  const res = await fetchChatCompletion(config, messages, maxTokens);
  const msg = res.choices[0]?.message ?? { role: "assistant", content: "" };

  let content = msg.content ?? "";
  // Fallback: some reasoning models may produce empty content
  if (!content && msg.reasoning_content) {
    content = extractFinalAnswer(msg.reasoning_content);
  }

  return {
    content,
    reasoningContent: msg.reasoning_content,
    finishReason: res.choices[0]?.finish_reason ?? null,
    usage: res.usage,
  };
}

// ---- helpers ---------------------------------------------------------------

/**
 * For reasoning models that output all text in reasoning_content,
 * try to extract the final answer (last meaningful paragraph).
 */
function extractFinalAnswer(reasoning: string): string {
  const lines = reasoning.trim().split("\n");
  // Walk backwards to find a non-empty line that looks like an answer
  const answerCandidates: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    answerCandidates.unshift(line);
    if (answerCandidates.length >= 3) break;
  }
  return answerCandidates.join("\n");
}
