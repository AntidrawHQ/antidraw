import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getAntidrawRoot } from "@/main/api/init";

// Private scratch space for one publish: the staged snapshot tree, the
// archive, blob copies, the built site and Vite's cache. It lives under the
// app root rather than os.tmpdir() so it is on the same volume as the
// workspaces (APFS clones in pack) and is never shared with other users.

const STAGING_PREFIX = "publish-";
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const stagingRoot = () => path.join(getAntidrawRoot(), "tmp");

// <antidrawRoot>/tmp/publish-<uuid>, mode 0700.
export const createStagingDir = async (): Promise<string> => {
  const root = stagingRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const dir = path.join(root, `${STAGING_PREFIX}${randomUUID()}`);
  await fs.mkdir(dir, { mode: 0o700 });
  return dir;
};

// Removes staging dirs a crashed or killed run left behind. A run cleans up
// after itself in `finally`, so anything older than 6 h that no live run
// holds is garbage. Best effort: a dir that cannot be read or removed now is
// tried again on the next publish.
export const sweepStaleStaging = async (keep: Set<string>): Promise<void> => {
  const root = stagingRoot();
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_AFTER_MS;
  await Promise.all(
    names
      .filter((name) => name.startsWith(STAGING_PREFIX))
      .map((name) => path.join(root, name))
      .filter((dir) => !keep.has(dir))
      .map(async (dir) => {
        try {
          const stat = await fs.lstat(dir);
          if (stat.mtimeMs >= cutoff) return;
          await fs.rm(dir, { recursive: true, force: true });
        } catch (e) {
          console.error(`Couldn't remove stale publish staging ${dir}:`, e);
        }
      }),
  );
};
