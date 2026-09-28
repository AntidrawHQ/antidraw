import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clashes, clashyPath, sitePath } from "../../test/arbitraries";
import { sha256 } from "../../test/helpers";
import { SiteUploadError } from "./errors";
import { DEFAULT_LIMITS } from "./limits";
import { parseManifest, sameFiles, type Files } from "./manifest";

// Property tests: fast-check generates inputs, and a failure prints the
// smallest input it could shrink to, plus a seed to replay it.

const HASHES = ["a", "b", "c", "d"].map((x) => sha256(x));
// Each hash always comes with the same size, as real files do.
const entry = fc.record(
  { n: fc.nat({ max: HASHES.length - 1 }), i: fc.boolean(), extra: fc.boolean() },
).map(({ n, i, extra }) => ({ h: HASHES[n]!, s: n * 7, ...(i ? { i: true } : {}), ...(extra ? { junk: n } : {}) }));

/** A manifest's files as JSON text, so keys like __proto__ arrive the way a request body delivers them. */
const fromJson = (pairs: [string, unknown][]) =>
  JSON.parse(`{"v":1,"files":{${pairs.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",")}}}`);

const attempt = (input: unknown, limits = DEFAULT_LIMITS) => {
  try {
    return { files: parseManifest(input, limits).files };
  } catch (err) {
    return { err };
  }
};

describe("parseManifest properties", () => {
  it("finds a file/folder clash exactly when the obvious check does", () => {
    const paths = fc.uniqueArray(clashyPath, { minLength: 1, maxLength: 8 });
    let clashing = 0;
    fc.assert(
      fc.property(paths, (ps) => {
        const { err } = attempt(fromJson(ps.map((p) => [p, { h: HASHES[0], s: 0 }])));
        if (!clashes(ps)) {
          expect(err).toBeUndefined();
          return;
        }
        clashing++;
        expect(err).toBeInstanceOf(SiteUploadError);
        const { code, details } = err as SiteUploadError;
        expect(code).toBe("INVALID_MANIFEST");
        // The path it names really is a file with something inside it.
        expect(ps.some((p) => p.startsWith(`${details?.path}/`))).toBe(true);
      }),
      { numRuns: 2000 },
    );
    // Guard against a generator that stops producing clashes.
    expect(clashing).toBeGreaterThan(200);
  });

  it("gives the same canonical result whatever the key order, and parsing it again changes nothing", () => {
    const pairs = fc
      .uniqueArray(fc.tuple(sitePath, entry), { minLength: 1, maxLength: 10, selector: ([p]) => p })
      .filter((ps) => !clashes(ps.map(([p]) => p)));
    const shuffled = pairs.chain((ps) =>
      fc.tuple(fc.constant(ps), fc.shuffledSubarray(ps, { minLength: ps.length, maxLength: ps.length })),
    );
    fc.assert(
      fc.property(shuffled, ([ordered, reordered]) => {
        const a = parseManifest(fromJson(ordered));
        const b = parseManifest(fromJson(reordered));
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        expect(sameFiles(a.files, b.files)).toBe(true);
        // Idempotent, both directly and after a trip through JSON (how pointers are stored).
        expect(JSON.stringify(parseManifest(a))).toBe(JSON.stringify(a));
        expect(JSON.stringify(parseManifest(JSON.parse(JSON.stringify(a))))).toBe(JSON.stringify(a));
        // Unknown fields are dropped, and every path survives.
        expect(Object.keys(a.files).sort()).toEqual(ordered.map(([p]) => p).sort());
        for (const e of Object.values(a.files)) expect(Object.keys(e).every((k) => ["h", "s", "i"].includes(k))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("returns a manifest or throws SiteUploadError for any input, never anything else", () => {
    const awkwardKey = fc.oneof(
      sitePath,
      fc.string(),
      fc.constantFrom("__proto__", "constructor", "toString", "hasOwnProperty", "prototype", "valueOf"),
    );
    const awkwardEntry = fc.oneof(entry, fc.jsonValue(), fc.record({ h: fc.oneof(fc.constant(HASHES[0]), fc.jsonValue()), s: fc.jsonValue() }));
    const input = fc.oneof(
      fc.anything(),
      fc.array(fc.tuple(awkwardKey, awkwardEntry), { maxLength: 8 }).map(fromJson),
      fc.array(fc.tuple(awkwardKey, entry), { minLength: 1, maxLength: 8 }).map(fromJson),
    );
    let accepted = 0;
    fc.assert(
      fc.property(input, (raw) => {
        const { files, err } = attempt(raw);
        if (err) {
          expect(err).toBeInstanceOf(SiteUploadError);
          return;
        }
        accepted++;
        // Null prototype: a path named __proto__ is an ordinary key, and lookups can't reach Object.prototype.
        expect(Object.getPrototypeOf(files)).toBe(null);
        expect(Object.keys(files!).sort()).toEqual(Object.keys((raw as { files: object }).files).sort());
        expect(attempt({ v: 1, files }).err).toBeUndefined();
      }),
      { numRuns: 3000 },
    );
    expect(accepted).toBeGreaterThan(100);
  });

  it("measures the file list as its JSON, less the outer braces", () => {
    const pairs = fc
      .uniqueArray(fc.tuple(sitePath, entry), { minLength: 1, maxLength: 10, selector: ([p]) => p })
      .filter((ps) => !clashes(ps.map(([p]) => p)));
    fc.assert(
      fc.property(pairs, (ps) => {
        const files: Files = parseManifest(fromJson(ps)).files;
        const { err } = attempt(fromJson(ps), { ...DEFAULT_LIMITS, maxManifestBytes: 1 });
        const counted = (err as SiteUploadError).details?.actual;
        // Each entry is counted with its colon and one comma, which is the whole
        // JSON less its braces, plus the comma the last entry doesn't have.
        expect(counted).toBe(new TextEncoder().encode(JSON.stringify(files)).length - 1);
      }),
      { numRuns: 1000 },
    );
  });
});
