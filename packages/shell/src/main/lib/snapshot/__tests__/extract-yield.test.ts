import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { extractSnapshot, FILES_PER_YIELD, readSnapshotManifest } from "../extract";
import { buildDeepManifestArchive, cleanupTmp, leftovers, makeTmp } from "./helpers";

// Records each path the manifest check validates, so the test can see which event-loop turn
// checked it. Everything else in ../paths is the real thing
const checked: { turn: number }[] = [];
let turn = 0;
vi.mock("../paths", async (importOriginal) => {
  const real = await importOriginal<typeof import("../paths")>();
  return {
    ...real,
    isSafeSnapshotPath: (p: string) => {
      checked.push({ turn });
      return real.isSafeSnapshotPath(p);
    },
  };
});

afterEach(() => {
  cleanupTmp();
  checked.length = 0;
});

// Runs `fn` while an immediate counts event-loop turns: a turn is where other main-process work
// (IPC, rendering the window) gets to run. Returns the most paths checked within one turn
const mostPathsPerTurn = async (fn: () => Promise<void>): Promise<number> => {
  let running = true;
  const tick = () => {
    turn++;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  try {
    await fn();
  } finally {
    running = false;
  }
  let most = 0;
  let run = 0;
  for (const [i, c] of checked.entries()) {
    run = i > 0 && checked[i - 1]!.turn === c.turn ? run + 1 : 1;
    most = Math.max(most, run);
  }
  return most;
};

describe("manifest validation in the main process", () => {
  // Counts turns rather than timing them, so a busy machine cannot fail it. That each path's
  // check is cheap is asserted in extract.test.ts, by how validation time grows with depth
  test("a manifest of many deep paths yields to the event loop every few files", async () => {
    const count = 4 * FILES_PER_YIELD + 1;
    const file = path.join(makeTmp(), "snapshot.tar.gz");
    await buildDeepManifestArchive(file, 510, count);

    const readMost = await mostPathsPerTurn(async () => {
      expect((await readSnapshotManifest(file))._unsafeUnwrap().files).toHaveLength(count);
    });
    expect(checked).toHaveLength(count);
    expect(readMost).toBeLessThanOrEqual(FILES_PER_YIELD);

    checked.length = 0;
    const destDir = path.join(makeTmp(), "source");
    const extractMost = await mostPathsPerTurn(async () => {
      const result = await extractSnapshot({ archiveFile: file, blobFile: () => undefined, destDir });
      expect(result._unsafeUnwrapErr().code).toBe("MANIFEST_MISMATCH");
      expect(result._unsafeUnwrapErr().message).toMatch(/missing from the archive/);
    });
    expect(checked).toHaveLength(count);
    expect(extractMost).toBeLessThanOrEqual(FILES_PER_YIELD);
    expect(leftovers(destDir)).toEqual([]);
  });
});
