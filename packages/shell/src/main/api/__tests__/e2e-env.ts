// Imported FIRST by e2e tests: relocates ~/.antidraw to a fresh tmp dir
// BEFORE any app module loads (init.ts reads ANTIDRAW_ROOT at import time).
// No mocks — the real DB, migrations and CLI run against this directory.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.ANTIDRAW_ROOT ??= mkdtempSync(path.join(tmpdir(), "antidraw-e2e-"));
