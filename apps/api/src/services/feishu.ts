/**
 * Feishu service — thin wrapper around lark-cli subprocess.
 *
 * All lark-cli invocations are spawned with shared flags:
 *   --json (structured output)
 *   --as user | bot (caller decides)
 *
 * lark-cli path is resolved from env LARK_CLI_PATH, falling back to the
 * conventional Linux installation path.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---- lark-cli binary resolution ---------------------------------------------

// Resolve lark-cli binary: env var → Linux default
function resolveLarkCli(): string {
  if (process.env.LARK_CLI_PATH) return process.env.LARK_CLI_PATH;

  const candidates = ["/usr/local/bin/lark-cli"];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Fallback to first candidate so spawn produces a clear "not found" error
  return candidates[0];
}

const LARK_CLI_BIN = resolveLarkCli();

/** Try to parse a string as lark-cli JSON envelope. Returns null if not JSON or no `ok` field. */
function tryParseLarkJson(raw: string): LarkResult<unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
      return parsed as LarkResult<unknown>;
    }
    // Non-envelope JSON: wrap as success
    return { ok: true, identity: "user", data: parsed };
  } catch {
    return null;
  }
}

/** Common env to silence lark-cli update notifier and skills notifier. */
const LARK_CLI_ENV = {
  ...process.env,
  LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
  LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
};

// ---- low-level runner -------------------------------------------------------

export type LarkIdentity = "user" | "bot";

export interface LarkOk<T> {
  ok: true;
  identity: LarkIdentity;
  data: T;
}

export interface LarkErr {
  ok: false;
  identity: LarkIdentity;
  error: {
    type: string;
    subtype?: string;
    code?: number;
    message: string;
    param?: string;
    log_id?: string;
    missing_scopes?: string[];
    console_url?: string;
  };
}

export type LarkResult<T> = LarkOk<T> | LarkErr;

/**
 * Run a lark-cli subcommand. Returns a structured result without throwing.
 * The CLI itself uses a {ok, identity, data|error} envelope.
 */
export function runLark<T = unknown>(
  args: string[],
  opts: { as?: LarkIdentity; timeoutMs?: number } = {},
): Promise<LarkResult<T>> {
  return new Promise((resolve) => {
    const fullArgs = [
      ...args,
      "--json",
      "--as",
      opts.as ?? "user",
    ];
    let proc;
    try {
      proc = spawn(LARK_CLI_BIN, fullArgs, {
        env: LARK_CLI_ENV,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({
        ok: false,
        identity: opts.as ?? "user",
        error: { type: "spawn", message: `lark-cli not available: ${(e as Error).message}` },
      });
      return;
    }

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      resolve({
        ok: false,
        identity: opts.as ?? "user",
        error: { type: "timeout", message: `lark-cli timeout after ${opts.timeoutMs ?? 30_000}ms` },
      });
    }, opts.timeoutMs ?? 30_000);

    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => errChunks.push(c));

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(chunks).toString("utf-8").trim();
      const stderr = Buffer.concat(errChunks).toString("utf-8").trim();

      // Try parsing stdout first
      if (stdout) {
        const parsed = tryParseLarkJson(stdout);
        if (parsed) {
          resolve(parsed as LarkResult<T>);
          return;
        }
      }

      // lark-cli sometimes outputs JSON to stderr — try that too
      if (stderr) {
        const parsed = tryParseLarkJson(stderr);
        if (parsed) {
          resolve(parsed as LarkResult<T>);
          return;
        }
      }

      // Non-JSON output
      if (code === 0 && stdout) {
        resolve({ ok: true, identity: opts.as ?? "user", data: stdout as unknown as T });
        return;
      }
      resolve({
        ok: false,
        identity: opts.as ?? "user",
        error: {
          type: "exit",
          message: stderr || stdout || `lark-cli exit code ${code} with no output`,
        },
      });
    });

    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        identity: opts.as ?? "user",
        error: { type: "spawn", message: e.message },
      });
    });
  });
}

// ---- typed wrappers --------------------------------------------------------

/**
 * Active meeting list response. Each item is a row in the table.
 */
export interface ActiveMeeting {
  meeting_id: string;
  topic: string;
  start_time?: string;
  end_time?: string;
  participant_count?: number;
}

/** Returns the active meeting list for the current identity. */
export async function listActiveMeetings(as: LarkIdentity = "user"): Promise<LarkResult<{ meetings: ActiveMeeting[] }>> {
  const r = await runLark<any>(["vc", "+meeting-list-active"], { as });
  if (!r.ok) return r;
  // CLI may return either {meetings: [...]} or just an array
  const data = Array.isArray(r.data) ? { meetings: r.data as ActiveMeeting[] } : r.data;
  return { ...r, data: data ?? { meetings: [] } };
}

export interface MeetingEvent {
  event_id?: string;
  event_type?: string;
  meeting_id?: string;
  start_time?: number | string;
  end_time?: number | string;
  speaker_id?: string;
  speaker_name?: string;
  speaker_role?: string;
  text?: string;
  content?: string;
  sentence_id?: string;
  timestamp?: number | string;
  // raw passthrough
  [k: string]: unknown;
}

/**
 * Pull meeting events. Returns raw event array (filter transcript events upstream).
 *
 * Note: lark-cli expects --meeting-id as a positive integer.
 */
export async function getMeetingEvents(
  meetingId: string | number,
  opts: { start: string; end: string; as?: LarkIdentity; pageAll?: boolean } & { pageSize?: number },
): Promise<LarkResult<{ events: MeetingEvent[]; has_more?: boolean; page_token?: string }>> {
  const args = [
    "vc",
    "+meeting-events",
    "--meeting-id",
    String(meetingId),
    "--start",
    opts.start,
    "--end",
    opts.end,
  ];
  if (opts.pageAll) args.push("--page-all");
  if (opts.pageSize) args.push("--page-size", String(opts.pageSize));
  const r = await runLark<any>(args, { as: opts.as ?? "user" });
  if (!r.ok) return r;
  const data = Array.isArray(r.data) ? { events: r.data as MeetingEvent[] } : r.data;
  return { ...r, data: data ?? { events: [] } };
}

export interface MeetingDetail {
  meeting_id: string;
  topic: string;
  status: string;
  minute_token?: string;
  note_id?: string;
  start_time?: string;
  end_time?: string;
}

/** Batch fetch meeting details (post-meeting, for minute_token). */
export async function getMeetingDetails(
  meetingIds: Array<string | number>,
  as: LarkIdentity = "user",
): Promise<LarkResult<{ meetings: MeetingDetail[] }>> {
  if (meetingIds.length === 0) {
    return { ok: true, identity: as, data: { meetings: [] } };
  }
  const r = await runLark<any>(
    ["vc", "+detail", "--meeting-ids", meetingIds.map(String).join(",")],
    { as },
  );
  if (!r.ok) return r;
  const list: MeetingDetail[] = Array.isArray(r.data) ? r.data : (r.data?.meetings ?? []);
  return { ...r, data: { meetings: list } };
}

export interface MinuteTranscriptLine {
  speaker_id?: string;
  speaker_name?: string;
  text: string;
  start_time?: string;
  end_time?: string;
  sentence_id?: string;
}

export interface MinuteTranscript {
  minute_token: string;
  meeting_id?: string;
  topic?: string;
  meeting_date?: string;
  keywords?: string[];
  lines: MinuteTranscriptLine[];
}

/** Fetch full transcript via minute_token. */
export async function getMinuteTranscript(
  minuteToken: string,
  as: LarkIdentity = "user",
): Promise<LarkResult<MinuteTranscript>> {
  // lark-cli saves transcript to a file and returns the file path in JSON.
  // We call with --transcript --overwrite to ensure fresh data.
  const r = await runLark<any>(
    ["minutes", "+detail", "--minute-tokens", minuteToken, "--transcript", "--overwrite"],
    { as, timeoutMs: 60_000 },
  );
  if (!r.ok) return r;

  const raw = r.data;
  let lines: MinuteTranscriptLine[] = [];
  let meeting_date: string | undefined;
  let keywords: string[] = [];

  // Try to find transcript file path in the response
  const minute = raw?.minutes?.[0];
  const transcriptFile = minute?.artifacts?.transcript_file;

  if (transcriptFile) {
    try {
      // Resolve relative to CWD (lark-cli saves relative to CWD)
      const cwd = process.cwd();
      const filePath = path.isAbsolute(transcriptFile)
        ? transcriptFile
        : path.resolve(cwd, transcriptFile);

      if (fs.existsSync(filePath)) {
        const text = fs.readFileSync(filePath, "utf-8");
        const parsed = parseTranscriptText(text);
        lines = parsed.lines;
        meeting_date = parsed.meeting_date;
        keywords = parsed.keywords ?? [];
      }
    } catch (e) {
      console.warn(`[feishu] failed to read transcript file: ${(e as Error).message}`);
    }
  }

  // Fallback: try parsing from JSON directly
  if (lines.length === 0) {
    if (Array.isArray(minute?.transcript)) {
      lines = minute.transcript;
    } else if (typeof minute?.transcript_text === "string") {
      const parsed = parseTranscriptText(minute.transcript_text);
      lines = parsed.lines;
      meeting_date = parsed.meeting_date;
      keywords = parsed.keywords ?? [];
    } else if (Array.isArray(raw?.lines)) {
      lines = raw.lines;
    } else if (Array.isArray(raw)) {
      lines = raw as MinuteTranscriptLine[];
    }
  }

  return {
    ...r,
    data: {
      minute_token: minuteToken,
      meeting_date: meeting_date ?? raw?.meeting_date,
      keywords: keywords.length > 0 ? keywords : raw?.keywords,
      ...raw,
      lines,
    },
  };
}

/**
 * Parse a Feishu minute transcript (.txt artifact) into structured lines.
 *
 * Expected format (actual lark-cli minutes artifact):
 *   2026-07-16 14:04:19 CST|1h 10min 41s
 *
 *   Keywords:
 *   飞书、智能、上下文、...
 *
 *   面试官 00:00:00.171
 *   这些名词之间是什么联系呢？...（可能跨多行）
 *
 *   候选人 00:00:20.291
 *   我们的 agent 呢，其实就是...
 *
 * Supported variants:
 *   - Date header is optional (may be absent in raw transcript_text)
 *   - Keywords section is optional
 *   - Speaker name may contain spaces (e.g. "Speaker 1")
 *   - Text may span multiple lines; blank lines delimit speaker blocks
 */
function parseTranscriptText(text: string): {
  lines: MinuteTranscriptLine[];
  meeting_date?: string;
  keywords?: string[];
} {
  const lines: MinuteTranscriptLine[] = [];
  let meeting_date: string | undefined;
  let keywords: string[] = [];

  const rawLines = text.split(/\n/);

  // Pattern: "Speaker Name HH:MM:SS.mmm" or "Speaker Name HH:MM:SS"
  const speakerRe = /^(.+?)\s+(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*$/;

  let i = 0;

  // ---- Phase 1: optional date header ----------------------------------------
  if (i < rawLines.length) {
    const dateMatch = rawLines[i].match(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}/);
    if (dateMatch) {
      meeting_date = dateMatch[1];
      i++;
      // Skip blank lines after header
      while (i < rawLines.length && rawLines[i].trim() === "") i++;
    }
  }

  // ---- Phase 2: optional Keywords section ------------------------------------
  if (i < rawLines.length && (rawLines[i].trim().startsWith("Keywords:") || rawLines[i].trim().startsWith("关键词:"))) {
    i++;
    // Collect keyword lines until we hit a speaker line or blank + speaker
    const kwParts: string[] = [];
    while (i < rawLines.length) {
      const t = rawLines[i].trim();
      if (speakerRe.test(t)) break;
      if (t === "" && i + 1 < rawLines.length && speakerRe.test(rawLines[i + 1].trim())) {
        i++; // skip blank before speaker
        break;
      }
      if (t !== "") kwParts.push(t);
      i++;
    }
    // Split on Chinese commas/English commas and deduplicate
    keywords = kwParts
      .join(" ")
      .split(/[,，、;；]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  // ---- Phase 3: speaker blocks -----------------------------------------------
  // Skip any remaining intro blank lines
  while (i < rawLines.length && rawLines[i].trim() === "") i++;

  while (i < rawLines.length) {
    const line = rawLines[i].trim();
    const match = speakerRe.exec(line);

    if (!match) {
      // Unexpected non-speaker line — skip it
      i++;
      continue;
    }

    const speakerName = match[1].trim();
    const timestamp = match[2];
    i++;

    // Collect text until next speaker line or EOF
    const textParts: string[] = [];
    while (i < rawLines.length) {
      const nextLine = rawLines[i].trim();
      if (speakerRe.test(nextLine)) break;
      if (nextLine !== "") {
        textParts.push(nextLine);
      }
      i++;
    }

    const text = textParts.join(" ").trim();
    if (text) {
      lines.push({
        speaker_name: speakerName,
        text,
        start_time: timestamp,
      });
    }
  }

  // ---- Fallback: if zero lines parsed, try old regex -------------------------
  if (lines.length === 0) {
    const re = /^(.+?)\s*\(?\[?(\d{2}:\d{2}(?::\d{2})?)\]?\)?\s*[:：]\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      lines.push({
        speaker_name: match[1].trim(),
        text: match[3].trim(),
        start_time: match[2],
      });
    }
    // Second fallback: split by newlines
    if (lines.length === 0) {
      const fallbackLines = text.split(/\n+/).filter((l) => l.trim());
      for (const raw of fallbackLines) {
        const colonIdx = raw.indexOf(":");
        if (colonIdx > 0 && colonIdx < 50) {
          lines.push({
            speaker_name: raw.slice(0, colonIdx).trim(),
            text: raw.slice(colonIdx + 1).trim(),
          });
        } else {
          lines.push({ text: raw.trim() });
        }
      }
    }
  }

  return { lines, meeting_date, keywords };
}

// ---- helpers ----------------------------------------------------------------

/**
 * Translate a lark-cli error into a human-friendly Chinese message.
 */
export function describeLarkError(err: LarkErr["error"]): string {
  if (err.code === 120002) {
    return "会议未开启『允许智能伙伴加入』开关，请在飞书会议设置中打开。";
  }
  if (err.code === 99991672) {
    return `应用缺少 scope：${err.missing_scopes?.join(", ") ?? "?"}。请到飞书开放平台授权。`;
  }
  if (err.type === "validation") {
    return `参数错误：${err.message}`;
  }
  if (err.type === "timeout") {
    return "请求超时，请重试。";
  }
  if (err.type === "spawn") {
    return `无法调用 lark-cli：${err.message}`;
  }
  return err.message || "未知错误";
}

/** True if the lark error indicates a retryable transient condition. */
export function isRetryableLarkError(err: LarkErr["error"]): boolean {
  // network/timeout/spawn — retry
  if (["timeout", "spawn", "exit"].includes(err.type)) return true;
  // 120002 is config issue, not transient
  if (err.code === 120002) return false;
  // scope issues not retryable
  if (err.code === 99991672) return false;
  // Validation errors not retryable
  if (err.type === "validation") return false;
  // Default: retry (could be rate limit / 5xx)
  return true;
}
