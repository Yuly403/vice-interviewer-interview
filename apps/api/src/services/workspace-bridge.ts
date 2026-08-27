/**
 * Workspace Bridge: the only filesystem boundary for approved review exports.
 * It accepts structured, already-authorized content and writes only beneath the
 * configured recruiting workspace allowlist using private, atomic files.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALLOWED_TOP_LEVEL = "03-interview";

function configuredRoot(): string {
  const root = process.env.WORKSPACE_ROOT;
  if (!root) throw new Error("WORKSPACE_ROOT must be configured before Workspace Bridge sync");
  return path.resolve(root);
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(value) || value === "." || value === "..") {
    throw new Error(`${label} is not a safe path segment`);
  }
  return value;
}

export function archivePaths(candidateSafeName: string, interviewId: string) {
  const root = configuredRoot();
  const candidate = safeSegment(candidateSafeName, "candidate name");
  const interview = safeSegment(interviewId, "interview id");
  const directory = path.resolve(root, ALLOWED_TOP_LEVEL, candidate, "rounds", interview);
  const prefix = `${root}${path.sep}`;
  if (!directory.startsWith(prefix)) throw new Error("Workspace Bridge path escaped configured root");
  return {
    root,
    directory,
    reviewPath: path.join(directory, "approved-review.md"),
    metadataPath: path.join(directory, "sync.json"),
  };
}

export function readExistingBridgeFiles(paths: ReturnType<typeof archivePaths>) {
  const read = (target: string): string | null => {
    try { return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null; } catch { return null; }
  };
  return { reviewMarkdown: read(paths.reviewPath), syncMetadata: read(paths.metadataPath) };
}

function atomicWrite(target: string, content: string): void {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, target);
}

export function writeApprovedReview(
  paths: ReturnType<typeof archivePaths>,
  markdown: string,
  syncMetadata: unknown,
  dryRun = false,
) {
  const metadata = `${JSON.stringify(syncMetadata, null, 2)}\n`;
  const contentHash = `sha256:${crypto.createHash("sha256").update(markdown).update("\0").update(metadata).digest("hex")}`;
  const manifest = { version: 1, allowedRoot: paths.root, reviewPath: paths.reviewPath, metadataPath: paths.metadataPath, contentHash };
  if (dryRun) return { ...manifest, written: false };
  fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  atomicWrite(paths.reviewPath, markdown);
  atomicWrite(paths.metadataPath, metadata);
  return { ...manifest, written: true };
}
