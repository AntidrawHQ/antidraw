import fs from "node:fs/promises";
import { constants as fsConstants, type Stats } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { err, ok, type Result } from "neverthrow";
import { findCaseCollisions, isExcludedSnapshotPath, isSafeSnapshotPath, snapshotExclusionReason } from "./paths";
import type { Exclusion, ExclusionGroup, ExclusionReport, ScannedFile, SnapshotError, SnapshotPlan } from "./types";
import { byteCompare, errorMessage, isDenied, isInside, isMissing, modeOf, toPosix } from "./util";

// Gitignored files matched by one (ignoreFile, rule) collapse into a group above this many
const GROUP_THRESHOLD = 20;
const GROUP_EXAMPLES = 5;

// ----------------------------------------------------------------------------
// .gitignore rules
// ----------------------------------------------------------------------------

type Matcher = { base: string; ig: Ignore; ignoreFile: string };
type TestResult = ReturnType<Ignore["test"]>;
export type IgnoreVerdict = { ignored: boolean; rule?: string; ignoreFile?: string };

// Match one path against one .gitignore's own patterns. Ignore#test also runs the patterns over
// every parent directory and lets an ignored parent decide, but a deeper .gitignore may have
// re-included that parent (`pkg/.gitignore: !dist/` under a root `dist` rule), and git then tests
// the child against the patterns alone. The walk never descends into an ignored directory, so the
// direct test is git's behaviour. Falls back to the public test if the internals ever move.
type RuleManager = { test(path: string, checkUnignored: boolean, mode: string): TestResult };
const directTest = (ig: Ignore, p: string): TestResult => {
  const rules = (ig as unknown as { _rules?: Partial<RuleManager> })._rules;
  return typeof rules?.test === "function" ? rules.test(p, true, "regex") : ig.test(p);
};

const parentOf = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};

// The .gitignore chain of a tree, read on demand and cached per directory, so a path can be
// tested before the walk reaches its directory (symlink targets)
export const createIgnoreRules = (rootDir: string) => {
  const matchers = new Map<string, Promise<Matcher | null>>();
  const chains = new Map<string, Promise<Matcher[]>>();

  const matcherFor = (relDir: string): Promise<Matcher | null> => {
    let pending = matchers.get(relDir);
    if (!pending) {
      pending = (async () => {
        const ignoreFile = relDir ? `${relDir}/.gitignore` : ".gitignore";
        const abs = path.join(rootDir, ignoreFile);
        try {
          // Only a regular file: a .gitignore symlink could point anywhere
          if (!(await fs.lstat(abs)).isFile()) return null;
          const contents = await fs.readFile(abs, "utf8");
          return { base: relDir, ig: ignore({ ignorecase: true }).add(contents), ignoreFile };
        } catch (e) {
          if (isMissing(e)) return null;
          throw e;
        }
      })();
      matchers.set(relDir, pending);
    }
    return pending;
  };

  const chainFor = (relDir: string): Promise<Matcher[]> => {
    let pending = chains.get(relDir);
    if (!pending) {
      pending = (async () => {
        const parent = relDir ? await chainFor(parentOf(relDir)) : [];
        const own = await matcherFor(relDir);
        return own ? [...parent, own] : parent;
      })();
      chains.set(relDir, pending);
    }
    return pending;
  };

  // git's precedence: every matcher from the root to the deepest runs, and the last one with a
  // verdict (ignored or re-included) wins
  const test = async (relPath: string, isDir: boolean): Promise<IgnoreVerdict> => {
    let verdict: IgnoreVerdict = { ignored: false };
    for (const m of await chainFor(parentOf(relPath))) {
      const local = (m.base ? relPath.slice(m.base.length + 1) : relPath) + (isDir ? "/" : "");
      const r = directTest(m.ig, local);
      if (r.ignored) verdict = { ignored: true, rule: r.rule?.pattern, ignoreFile: m.ignoreFile };
      else if (r.unignored) verdict = { ignored: false };
    }
    return verdict;
  };

  // True when the file, or any directory above it, is ignored
  const ignoredWithAncestors = async (relPath: string): Promise<boolean> => {
    const segments = relPath.split("/");
    for (let i = 1; i < segments.length; i++) {
      if ((await test(segments.slice(0, i).join("/"), true)).ignored) return true;
    }
    return (await test(relPath, false)).ignored;
  };

  return { test, ignoredWithAncestors };
};

export type IgnoreRules = ReturnType<typeof createIgnoreRules>;

// A symlink target (relative to the real source root) is snapshotted only when scan would
// include the target at its own path
export const isIncludableTarget = async (rules: IgnoreRules, target: string): Promise<boolean> =>
  isSafeSnapshotPath(target) && !isExcludedSnapshotPath(target) && !(await rules.ignoredWithAncestors(target));

// ----------------------------------------------------------------------------
// Scan
// ----------------------------------------------------------------------------

class Cancelled extends Error {}

const groupReport = (listed: Exclusion[], gitignoredFiles: Exclusion[]): ExclusionReport => {
  const byRule = new Map<string, Exclusion[]>();
  for (const e of gitignoredFiles) {
    const key = `${e.ignoreFile ?? ""}\0${e.rule ?? ""}`;
    const bucket = byRule.get(key);
    if (bucket) bucket.push(e);
    else byRule.set(key, [e]);
  }

  const grouped: ExclusionGroup[] = [];
  for (const bucket of byRule.values()) {
    if (bucket.length <= GROUP_THRESHOLD) {
      listed.push(...bucket);
      continue;
    }
    const paths = bucket.map((e) => e.path).sort(byteCompare);
    grouped.push({
      reason: "gitignored",
      ignoreFile: bucket[0]?.ignoreFile ?? "",
      rule: bucket[0]?.rule ?? "",
      count: bucket.length,
      examples: paths.slice(0, GROUP_EXAMPLES),
    });
  }

  listed.sort((a, b) => byteCompare(a.path, b.path));
  grouped.sort((a, b) => byteCompare(a.ignoreFile, b.ignoreFile) || byteCompare(a.rule, b.rule));
  return { listed, grouped };
};

// Selects the files of a snapshot: .gitignore rules (nested, git precedence), always-excludes and
// secrets that no rule can re-include, the symlink policy, and case collisions
export const scanWorkspace = async (
  sourceDir: string,
  opts?: { signal?: AbortSignal },
): Promise<Result<SnapshotPlan, SnapshotError>> => {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(sourceDir);
    if (!(await fs.stat(realRoot)).isDirectory()) throw new Error("not a directory");
  } catch {
    return err({ code: "SOURCE_MISSING", message: `Workspace source not found: ${sourceDir}` });
  }

  const rules = createIgnoreRules(realRoot);
  const files: ScannedFile[] = [];
  const listed: Exclusion[] = [];
  const gitignoredFiles: Exclusion[] = [];

  const exclude = (rel: string, isDir: boolean, reason: Exclusion["reason"]) => {
    listed.push({ path: isDir ? `${rel}/` : rel, isDir, reason });
  };

  const checkAbort = () => {
    if (opts?.signal?.aborted) throw new Cancelled();
  };

  const readable = async (abs: string): Promise<boolean> => {
    try {
      await fs.access(abs, fsConstants.R_OK);
      return true;
    } catch (e) {
      if (isDenied(e)) return false;
      throw e;
    }
  };

  const addSymlink = async (rel: string, abs: string) => {
    let real: string;
    let target: Stats;
    try {
      real = await fs.realpath(abs);
      target = await fs.stat(real);
    } catch (e) {
      // ENOENT, ENOTDIR, ELOOP: nothing usable at the other end
      return exclude(rel, false, isDenied(e) ? "unreadable" : "symlink-broken");
    }
    if (!isInside(realRoot, real)) return exclude(rel, false, "symlink-outside");
    // Directory links would allow cycles and count files twice
    if (target.isDirectory()) return exclude(rel, false, "symlink-directory");
    if (!target.isFile()) return exclude(rel, false, "not-a-regular-file");
    if (!(await isIncludableTarget(rules, toPosix(path.relative(realRoot, real))))) {
      return exclude(rel, false, "symlink-to-excluded");
    }
    if (!(await readable(real))) return exclude(rel, false, "unreadable");

    // Stored as a regular file with the target's content
    files.push({
      path: rel,
      absPath: real,
      size: target.size,
      mode: modeOf(target),
      viaSymlink: true,
      dev: target.dev,
      ino: target.ino,
    });
  };

  const walk = async (relDir: string): Promise<void> => {
    checkAbort();
    const absDir = relDir ? path.join(realRoot, relDir) : realRoot;

    const names: string[] = [];
    try {
      for await (const entry of await fs.opendir(absDir)) names.push(entry.name);
    } catch (e) {
      if (relDir && isDenied(e)) return exclude(relDir, true, "unreadable");
      throw e;
    }
    names.sort(byteCompare);

    for (const name of names) {
      checkAbort();
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = path.join(absDir, name);

      let stats: Stats;
      try {
        stats = await fs.lstat(abs);
      } catch (e) {
        if (isMissing(e)) continue; // removed while scanning
        if (isDenied(e)) {
          exclude(rel, false, "unreadable");
          continue;
        }
        throw e;
      }
      const isDir = stats.isDirectory();

      // Always-excludes and secrets come first: no `!` rule can re-include them
      const fixed = snapshotExclusionReason(rel, isDir);
      if (fixed) {
        exclude(rel, isDir, fixed);
        continue;
      }
      if (!isSafeSnapshotPath(rel)) {
        exclude(rel, isDir, "unsupported-name");
        continue;
      }

      const verdict = await rules.test(rel, isDir);
      if (verdict.ignored) {
        const exclusion: Exclusion = {
          path: isDir ? `${rel}/` : rel,
          isDir,
          reason: "gitignored",
          ...(verdict.rule !== undefined && { rule: verdict.rule }),
          ...(verdict.ignoreFile !== undefined && { ignoreFile: verdict.ignoreFile }),
        };
        // An ignored directory is not descended into (as in git) and is always listed on its own
        if (isDir) listed.push(exclusion);
        else gitignoredFiles.push(exclusion);
        continue;
      }

      if (isDir) {
        await walk(rel);
      } else if (stats.isSymbolicLink()) {
        await addSymlink(rel, abs);
      } else if (!stats.isFile()) {
        exclude(rel, false, "not-a-regular-file");
      } else if (!(await readable(abs))) {
        exclude(rel, false, "unreadable");
      } else {
        files.push({
          path: rel,
          absPath: abs,
          size: stats.size,
          mode: modeOf(stats),
          viaSymlink: false,
          dev: stats.dev,
          ino: stats.ino,
        });
      }
    }
  };

  try {
    await walk("");
  } catch (e) {
    if (e instanceof Cancelled) return err({ code: "CANCELLED", message: "Snapshot cancelled" });
    return err({ code: "SCAN_FAILED", message: `Couldn't scan the workspace: ${errorMessage(e)}` });
  }

  const collisions = findCaseCollisions(files.map((f) => f.path));
  if (collisions.length > 0) {
    return err({
      code: "CASE_COLLISION",
      message: `Some file names differ only by case: ${collisions.map((g) => g.join(", ")).join("; ")}`,
      paths: collisions,
    });
  }

  files.sort((a, b) => byteCompare(a.path, b.path));
  return ok({ sourceDir: realRoot, files, excluded: groupReport(listed, gitignoredFiles) });
};
