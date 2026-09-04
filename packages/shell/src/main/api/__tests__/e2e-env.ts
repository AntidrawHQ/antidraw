// Imported FIRST by e2e tests: relocates ~/.antidraw to a fresh tmp dir
// BEFORE any app module loads (init.ts reads ANTIDRAW_ROOT at import time).
// No mocks — the real DB, migrations and CLI run against this directory.
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";

// Only a root this harness minted may ever be rm -rf'd. ANTIDRAW_ROOT is the
// documented profile override (see init.ts), so a preset value can point at a
// real profile — deleting it would take antidraw.db and every workspace
// source tree with it.
export const OWNS_ROOT = !process.env.ANTIDRAW_ROOT;
process.env.ANTIDRAW_ROOT ??= mkdtempSync(path.join(tmpdir(), "antidraw-e2e-"));

// Each importing file's worker mints its own root; remove it when the file's
// tests finish so runs stop accumulating in os.tmpdir(). The afterAll is the
// one that actually runs — vitest's forks pool tears workers down without a
// clean process exit — but the exit handler stays for a worker that dies
// between the hook and the teardown.
if (OWNS_ROOT) {
  const removeRoot = () =>
    rmSync(process.env.ANTIDRAW_ROOT!, { recursive: true, force: true });
  afterAll(removeRoot);
  process.on("exit", removeRoot);
}
