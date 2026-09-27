import { createHash } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "neverthrow";
import { isExcludedSnapshotPath, isSafeSnapshotPath } from "./paths";
import { createIgnoreRules, isIncludableTarget, type IgnoreRules } from "./scan";
import {
  LARGE_FILE_BYTES,
  type ManifestEntry,
  type ScannedFile,
  type SnapshotError,
  type SnapshotPlan,
  type StagedSnapshot,
} from "./types";
import { HAS_NOFOLLOW, READ_NOFOLLOW, byteCompare, errorMessage, isInside, nativePath, toPosix } from "./util";

const COPY_CHUNK = 1024 * 1024;

class StageFailure extends Error {
  constructor(readonly failure: SnapshotError) {
    super(failure.message);
  }
}

const stageFailed = (p: string, reason: string) =>
  new StageFailure({ code: "STAGE_FAILED", message: `${p}: ${reason}`, paths: [p] });

// Opens the file scan chose, and nothing else. A viaSymlink entry re-resolves its link and must
// still land on an includable target inside the source. The final open refuses a symlink, and
// the handle must be the scan-time inode: swapping the file or any parent directory for a symlink
// between scan and stage changes it
const openScanned = async (
  file: ScannedFile,
  realRoot: string,
  rules: IgnoreRules,
): Promise<FileHandle> => {
  if (!isSafeSnapshotPath(file.path) || isExcludedSnapshotPath(file.path)) {
    throw stageFailed(file.path, "path is not allowed in a snapshot");
  }

  let target = file.absPath;
  if (file.viaSymlink) {
    let real: string;
    try {
      real = await fs.realpath(nativePath(realRoot, file.path));
    } catch (e) {
      throw stageFailed(file.path, `symlink no longer resolves (${errorMessage(e)})`);
    }
    if (!isInside(realRoot, real) || !(await isIncludableTarget(rules, toPosix(path.relative(realRoot, real))))) {
      throw stageFailed(file.path, "symlink now points at a file that is not part of the snapshot");
    }
    if (real !== file.absPath) throw stageFailed(file.path, "symlink target changed since the scan");
    target = real;
  }

  if (!HAS_NOFOLLOW) {
    const pre = await fs.lstat(target).catch(() => null);
    if (!pre?.isFile()) throw stageFailed(file.path, "file changed since the scan");
  }

  let handle: FileHandle;
  try {
    handle = await fs.open(target, READ_NOFOLLOW);
  } catch (e) {
    throw stageFailed(file.path, `couldn't open the file (${errorMessage(e)})`);
  }
  const stats = await handle.stat();
  if (!stats.isFile() || stats.dev !== file.dev || stats.ino !== file.ino) {
    await handle.close();
    throw stageFailed(file.path, "file changed since the scan");
  }
  return handle;
};

// Stream-copies one file, hashing the copied bytes. They define the size and sha256; they may
// differ from the scan-time size, the inode may not
const copyHashed = async (src: FileHandle, dest: string, mode: number): Promise<{ size: number; sha256: string }> => {
  const hash = createHash("sha256");
  const buf = Buffer.allocUnsafe(COPY_CHUNK);
  let size = 0;
  const out = await fs.open(dest, "wx", mode);
  try {
    for (;;) {
      const { bytesRead } = await src.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      const chunk = buf.subarray(0, bytesRead);
      hash.update(chunk);
      await out.write(chunk);
      size += bytesRead;
    }
    await out.chmod(mode); // the umask may have narrowed the open mode
  } finally {
    await out.close();
  }
  return { size, sha256: hash.digest("hex") };
};

// Copies exactly the scanned files into `destDir` (which must not exist) and builds the manifest
export const stageSnapshot = async (
  plan: SnapshotPlan,
  destDir: string,
  opts?: { signal?: AbortSignal },
): Promise<Result<StagedSnapshot, SnapshotError>> => {
  try {
    await fs.mkdir(destDir, { mode: 0o700 });
  } catch (e) {
    return err({ code: "STAGE_FAILED", message: `Couldn't create the staging directory: ${errorMessage(e)}` });
  }

  try {
    const realRoot = await fs.realpath(plan.sourceDir);
    const rules = createIgnoreRules(realRoot);
    const files = [...plan.files].sort((a, b) => byteCompare(a.path, b.path));
    const entries: ManifestEntry[] = [];

    for (const file of files) {
      if (opts?.signal?.aborted) throw new StageFailure({ code: "CANCELLED", message: "Snapshot cancelled" });

      const src = await openScanned(file, realRoot, rules);
      try {
        const dest = nativePath(destDir, file.path);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const { size, sha256 } = await copyHashed(src, dest, file.mode);
        entries.push({
          path: file.path,
          size,
          sha256,
          mode: file.mode,
          storage: size >= LARGE_FILE_BYTES ? "blob" : "archive",
        });
      } finally {
        await src.close();
      }
    }

    return ok({ dir: destDir, manifest: { version: 1, files: entries }, excluded: plan.excluded });
  } catch (e) {
    await fs.rm(destDir, { recursive: true, force: true });
    if (e instanceof StageFailure) return err(e.failure);
    return err({ code: "STAGE_FAILED", message: `Couldn't stage the snapshot: ${errorMessage(e)}` });
  }
};
