import { describe, expect, it } from "vitest";
import {
  caseKey,
  isExcludedSnapshotPath,
  isImmutableSitePath,
  isPublishableSitePath,
  isSafeSnapshotPath,
} from "./paths";

describe("isSafeSnapshotPath", () => {
  it.each([
    ["src/App.tsx", true],
    ["a/b/c.txt", true],
    [".gitignore", true],
    ["ü/ñ.png", true],
    ["", false],
    ["/abs", false],
    ["..", false],
    ["../evil", false],
    ["a/../b", false],
    ["a/./b", false],
    ["a//b", false],
    ["a/", false],
    ["a\\b", false],
    ["a\0b", false],
    ["a\nb", false],
    ["a\x7fb", false],
    [`${"x".repeat(256)}`, false],
    [`${"x".repeat(255)}`, true],
    [Array.from({ length: 5 }, () => "x".repeat(250)).join("/"), false],
  ])("%j -> %s", (p, safe) => {
    expect(isSafeSnapshotPath(p)).toBe(safe);
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(isSafeSnapshotPath("é".repeat(127))).toBe(true); // 254 bytes
    expect(isSafeSnapshotPath("é".repeat(128))).toBe(false); // 256 bytes
  });
});

describe("isPublishableSitePath", () => {
  it.each([
    ["assets/index-AbC12345.js", false, true],
    ["logo.png", false, true],
    [".well-known/x", false, true],
    [".well-known/a/b", false, true],
    ["a/.well-known/x", false, false],
    [".env", false, false],
    ["public/.env", false, false],
    [".DS_Store", false, false],
    ["a/.b/c", false, false],
    ["assets/.Dot-AbC12345.js", true, true],
    ["assets/.Dot-AbC12345.js", false, false],
    ["other/.Dot-AbC12345.js", true, false],
    // Entry pages are ordinary site files.
    ["index.html", false, true],
    ["preview.html", true, true],
    ["canvas.json", false, true],
    [".hashed-files.json", true, false],
    ["../x", false, false],
    ["/x", false, false],
    ["a\\b", false, false],
    ["a\0b", false, false],
    ["sub/index.html", false, true],
  ])("%j (immutable %s) -> %s", (p, immutable, ok) => {
    expect(isPublishableSitePath(p, immutable)).toBe(ok);
  });
});

describe("isImmutableSitePath", () => {
  it.each([
    ["_antidraw/viewer-AbC12345.js", true],
    ["_antidraw/fonts/x.woff2", true],
    ["assets/index-AbC12345.js", true],
    ["assets/deep/chunk-a_b-C1234567.css", true],
    ["assets/logo.png", false],
    ["assets/index-AbC1234.js", false],
    ["index.html", false],
    ["logo-AbC12345.png", false],
  ])("%j -> %s", (p, immutable) => {
    expect(isImmutableSitePath(p)).toBe(immutable);
  });
});

// The same table as the app's snapshot paths test
// (packages/shell src/main/lib/snapshot): both sides must agree.
describe("isExcludedSnapshotPath", () => {
  it.each([
    [".git/config", true],
    ["a/.Claude/x", true],
    [".claude/settings.json", true],
    ["node_modules/x", true],
    ["a/node_modules/x/index.js", true],
    [".vercel/project.json", true],
    ["dist/x", true],
    ["out/x", true],
    [".vite/deps.json", true],
    ["src/dist/x", false],
    ["src/lib/out/x.ts", false],
    ["dist", false],
    [".env", true],
    [".env.local", true],
    ["sub/.ENV.production", true],
    [".DS_Store", true],
    ["a/.ds_store", true],
    ["a/.npmrc", true],
    [".yarnrc.yml", true],
    ["sub/.dev.vars", true],
    [".netrc", true],
    [".git-credentials", true],
    [".pypirc", true],
    ["k/id_rsa", true],
    ["id_ed25519.pub", true],
    ["x.pem", true],
    ["certs/a.P12", true],
    ["a.pfx", true],
    [".aws/credentials", true],
    [".ssh/config", true],
    [".gnupg/x", true],
    ["slides.key", false],
    ["src/App.tsx", false],
    [".gitignore", false],
    ["public/logo.png", false],
    ["environment.ts", false],
    // Names APFS case-folds onto a denylisted one (ſ → s, K → k), which toLowerCase misses
    ["node_module\u017f/x", true],
    [".\u017f\u017fh/id", true],
    ["a/.aw\u017f/credentials", true],
    [".dev.var\u017f", true],
    [".git-credential\u017f", true],
    ["k/id_r\u017fa", true],
    ["a/.DS_\u017ftore", true],
  ])("%j -> %s", (p, excluded) => {
    expect(isExcludedSnapshotPath(p)).toBe(excluded);
  });
});

describe("caseKey", () => {
  it("folds like APFS: ſ = s, K = k, ß = ss, NFD = NFC", () => {
    expect(caseKey("\u017f.txt")).toBe(caseKey("S.txt"));
    expect(caseKey("\u212a.bin")).toBe(caseKey("k.bin"));
    expect(caseKey("stra\u00dfe")).toBe(caseKey("STRASSE"));
    expect(caseKey("cafe\u0301")).toBe(caseKey("CAF\u00c9"));
    expect(caseKey("a.txt")).not.toBe(caseKey("b.txt"));
  });
});
