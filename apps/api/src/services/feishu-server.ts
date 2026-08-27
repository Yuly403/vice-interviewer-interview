/**
 * Server-side Feishu adapter for the internal pilot.
 *
 * This adapter deliberately uses the application's own credentials and the
 * documented Open Platform APIs. It does not depend on a developer machine,
 * a browser profile, or a locally authenticated CLI process.
 *
 * The pilot is intentionally post-meeting first: meeting recordings/minutes
 * are reconciled after the interviewer confirms the candidate and round.
 * Live subtitle polling remains an experimental integration and is disabled
 * by default in server deployments.
 */

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";
const TOKEN_SAFETY_WINDOW_MS = 60_000;

interface CachedTenantToken {
  value: string;
  expiresAt: number;
}

let cachedTenantToken: CachedTenantToken | null = null;

export interface FeishuServerError {
  type: "config" | "network" | "upstream" | "response";
  code?: number;
  message: string;
}

export type FeishuServerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: FeishuServerError };

export interface ServerMinuteTranscriptLine {
  speaker_id?: string;
  speaker_name?: string;
  text: string;
  start_time?: string;
  end_time?: string;
  sentence_id?: string;
}

function config(): { appId: string; appSecret: string } {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET must be configured before the Feishu server adapter is enabled.");
  }
  return { appId, appSecret };
}

async function tenantAccessToken(): Promise<FeishuServerResult<string>> {
  if (cachedTenantToken && cachedTenantToken.expiresAt > Date.now() + TOKEN_SAFETY_WINDOW_MS) {
    return { ok: true, data: cachedTenantToken.value };
  }

  let credentials: { appId: string; appSecret: string };
  try {
    credentials = config();
  } catch (error) {
    return { ok: false, error: { type: "config", message: (error as Error).message } };
  }

  try {
    const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret }),
    });
    const payload = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
      return {
        ok: false,
        error: { type: "upstream", code: payload.code, message: payload.msg || `Feishu tenant token request failed: HTTP ${response.status}` },
      };
    }
    cachedTenantToken = {
      value: payload.tenant_access_token,
      expiresAt: Date.now() + Math.max((payload.expire ?? 7200) * 1000, TOKEN_SAFETY_WINDOW_MS),
    };
    return { ok: true, data: cachedTenantToken.value };
  } catch (error) {
    return { ok: false, error: { type: "network", message: `Feishu tenant token request failed: ${(error as Error).message}` } };
  }
}

async function get<T>(path: string, query?: Record<string, string>): Promise<FeishuServerResult<T>> {
  const token = await tenantAccessToken();
  if (!token.ok) return token;

  const url = new URL(`${FEISHU_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.data}` } });
    const payload = await response.json() as { code?: number; msg?: string; data?: T };
    if (!response.ok || payload.code !== 0 || payload.data === undefined) {
      return { ok: false, error: { type: "upstream", code: payload.code, message: payload.msg || `Feishu API request failed: HTTP ${response.status}` } };
    }
    return { ok: true, data: payload.data };
  } catch (error) {
    return { ok: false, error: { type: "network", message: `Feishu API request failed: ${(error as Error).message}` } };
  }
}

function findString(value: unknown, names: Set<string>): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, names);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (names.has(key) && typeof item === "string" && item.trim()) return item.trim();
    const found = findString(item, names);
    if (found) return found;
  }
  return undefined;
}

function minuteTokenFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const explicit = url.searchParams.get("minute_token") ?? url.searchParams.get("minutes_token");
    if (explicit) return explicit;
    const match = url.pathname.match(/\/(?:minutes|minute)\/([^/?#]+)/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** Resolve a minutes token from a meeting. The API response differs slightly by tenant feature set. */
export async function resolveMinuteToken(meetingId: string): Promise<FeishuServerResult<string>> {
  const detail = await get<unknown>(`/vc/v1/meetings/${encodeURIComponent(meetingId)}`);
  if (!detail.ok) return detail;
  const directToken = findString(detail.data, new Set(["minute_token", "minutes_token"]));
  if (directToken) return { ok: true, data: directToken };
  const detailUrl = findString(detail.data, new Set(["minutes_url", "minute_url"]));
  const tokenFromDetailUrl = minuteTokenFromUrl(detailUrl);
  if (tokenFromDetailUrl) return { ok: true, data: tokenFromDetailUrl };

  const recording = await get<unknown>(`/vc/v1/meetings/${encodeURIComponent(meetingId)}/recording`);
  if (!recording.ok) return recording;
  const recordingToken = findString(recording.data, new Set(["minute_token", "minutes_token"]));
  if (recordingToken) return { ok: true, data: recordingToken };
  const recordingUrl = findString(recording.data, new Set(["minutes_url", "minute_url", "url"]));
  const tokenFromRecordingUrl = minuteTokenFromUrl(recordingUrl);
  if (tokenFromRecordingUrl) return { ok: true, data: tokenFromRecordingUrl };
  return { ok: false, error: { type: "response", message: "No Feishu Minutes token is available for this meeting. Confirm that recording and Minutes are enabled, then wait for the post-meeting artifact to finish generating." } };
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  return undefined;
}

function textFrom(value: Record<string, unknown>): string | undefined {
  for (const key of ["text", "content", "transcript", "sentence", "sentence_text"]) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return undefined;
}

function collectTranscriptLines(
  value: unknown,
  output: ServerMinuteTranscriptLine[],
  context: Pick<ServerMinuteTranscriptLine, "speaker_id" | "speaker_name" | "start_time" | "end_time"> = {},
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTranscriptLines(item, output, context);
    return;
  }
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  const inherited = {
    speaker_id: typeof item.speaker_id === "string" ? item.speaker_id : context.speaker_id,
    speaker_name: typeof item.speaker_name === "string" ? item.speaker_name : typeof item.speaker === "string" ? item.speaker : context.speaker_name,
    start_time: toIsoTimestamp(item.start_time ?? item.start_time_ms ?? item.timestamp) ?? context.start_time,
    end_time: toIsoTimestamp(item.end_time ?? item.end_time_ms) ?? context.end_time,
  };
  const text = textFrom(item);
  if (text) {
    output.push({
      speaker_id: inherited.speaker_id,
      speaker_name: inherited.speaker_name,
      text,
      start_time: inherited.start_time,
      end_time: inherited.end_time,
      sentence_id: typeof item.sentence_id === "string" ? item.sentence_id : typeof item.id === "string" ? item.id : undefined,
    });
    return;
  }
  for (const key of ["transcript", "paragraphs", "sentences", "items", "records", "data"]) {
    if (item[key] !== undefined) collectTranscriptLines(item[key], output, inherited);
  }
}

/** Export a completed Feishu Minutes transcript through the official API. */
export async function getServerMinuteTranscript(minuteToken: string): Promise<FeishuServerResult<{ lines: ServerMinuteTranscriptLine[] }>> {
  const transcript = await get<unknown>(`/minutes/v1/minutes/${encodeURIComponent(minuteToken)}/transcript`, {
    need_speaker: "true",
    need_timestamp: "true",
  });
  if (!transcript.ok) return transcript;
  const lines: ServerMinuteTranscriptLine[] = [];
  collectTranscriptLines(transcript.data, lines);
  if (lines.length === 0) {
    return { ok: false, error: { type: "response", message: "Feishu returned a Minutes artifact, but no readable transcript lines were found. Keep this interview in manual review and verify the tenant transcript export format." } };
  }
  return { ok: true, data: { lines } };
}

export function describeFeishuServerError(error: FeishuServerError): string {
  if (error.type === "config") return "飞书服务端凭据或回调配置未完成。";
  if (error.code === 99991672) return "飞书应用缺少所需权限，请核对已获批的会议或妙记权限。";
  return error.message;
}
