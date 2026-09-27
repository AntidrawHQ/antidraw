import { describe, expect, test } from "vitest";
import {
  contentKey,
  createPointerCache,
  entryFor,
  cachedHeapOf,
  loadingHeapOf,
  MalformedPointerError,
  MAX_CACHED_HEAP,
  MAX_LOADING_HEAP,
  MAX_POINTER_BYTES,
  parsePointer,
  pointerKey,
  PointerBusyError,
  MISS_REVALIDATE_MS,
  REVALIDATE_MS,
} from "../src/pointer";
import { createMemoryR2 } from "./memory-r2";

const SHA = "a".repeat(64);
const pointerText = (version: number, files: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, version, u: "user_1", files });

describe("keys", () => {
  test("pointer and content keys", () => {
    expect(pointerKey("my-site")).toBe("m/my-site.json");
    expect(contentKey("user_1", SHA)).toBe(`c/user_1/${SHA}`);
  });
});

describe("parsePointer", () => {
  test("takes a well-formed pointer", () => {
    const pointer = parsePointer(pointerText(3, { "index.html": { h: SHA, s: 1, t: "text/html" } }));
    expect(pointer?.version).toBe(3);
    expect(pointer?.u).toBe("user_1");
  });

  test.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["another format version", JSON.stringify({ v: 2, version: 1, u: "u", files: {} })],
    ["a fractional version", JSON.stringify({ v: 1, version: 1.5, u: "u", files: {} })],
    ["no owner", JSON.stringify({ v: 1, version: 1, files: {} })],
    ["an owner that is a path", JSON.stringify({ v: 1, version: 1, u: "../x", files: {} })],
    ["an owner with a slash", JSON.stringify({ v: 1, version: 1, u: "a/b", files: {} })],
    ["files as a list", JSON.stringify({ v: 1, version: 1, u: "u", files: [] })],
  ])("refuses %s", (_, text) => {
    expect(parsePointer(text)).toBeNull();
  });
});

describe("entryFor", () => {
  const pointer = parsePointer(
    JSON.stringify({
      v: 1,
      version: 1,
      u: "u",
      files: {
        "index.html": { h: SHA, s: 10, t: "text/html; charset=utf-8" },
        "assets/index-AbC12345.js": { h: SHA, s: 5, t: "text/javascript", i: 1 },
        "assets/logo-original.png": { h: SHA, s: 5, t: "image/png", i: 0 },
        "bad-immutable": { h: SHA, s: 1, t: "text/plain", i: true },
        "bad-sha": { h: "A".repeat(64), s: 1, t: "text/plain" },
        "bad-size": { h: SHA, s: -1, t: "text/plain" },
        "bad-type": { h: SHA, s: 1, t: "text/plain\r\nSet-Cookie: x=1" },
        "not-an-object": "x",
      },
    }),
  )!;

  test("an entry", () => {
    expect(entryFor(pointer, "index.html")).toEqual({
      h: SHA,
      s: 10,
      t: "text/html; charset=utf-8",
      i: false,
    });
  });

  test("immutable only where the pointer says so, never from the name", () => {
    expect(entryFor(pointer, "assets/index-AbC12345.js")).toMatchObject({ i: true });
    expect(entryFor(pointer, "assets/logo-original.png")).toMatchObject({ i: false });
  });

  test("a path the site does not have", () => {
    expect(entryFor(pointer, "missing.js")).toBeUndefined();
  });

  test("only the pointer's own paths: none from Object.prototype", () => {
    expect(entryFor(pointer, "constructor")).toBeUndefined();
    expect(entryFor(pointer, "__proto__")).toBeUndefined();
    expect(entryFor(pointer, "hasOwnProperty")).toBeUndefined();
  });

  test.each(["bad-immutable", "bad-sha", "bad-size", "bad-type", "not-an-object"])("%s is malformed", (path) => {
    expect(entryFor(pointer, path)).toBe("malformed");
  });
});

describe("createPointerCache", () => {
  const setup = () => {
    const r2 = createMemoryR2();
    let time = 1_000_000;
    const cache = createPointerCache(() => time);
    return {
      r2,
      cache,
      advance: (ms: number) => {
        time += ms;
      },
    };
  };

  test("reads a pointer once, then serves it from memory for the revalidation window", async () => {
    const { r2, cache, advance } = setup();
    const uploaded = new Date("2026-09-01T00:00:00Z");
    r2.put("m/s.json", pointerText(1), uploaded);

    const first = await cache.load(r2.bucket, "s");
    expect(first.pointer?.version).toBe(1);
    expect(first.written).toEqual(uploaded);
    advance(REVALIDATE_MS - 1);
    await cache.load(r2.bucket, "s");
    expect(r2.reads).toEqual(["m/s.json"]);
  });

  test("revalidates after the window, and keeps the cached copy when it has not changed", async () => {
    const { r2, cache, advance } = setup();
    r2.put("m/s.json", pointerText(1));
    await cache.load(r2.bucket, "s");
    advance(REVALIDATE_MS);
    const again = await cache.load(r2.bucket, "s");
    expect(again.pointer?.version).toBe(1);
    expect(r2.reads).toEqual(["m/s.json", "m/s.json"]);
  });

  test("picks up a new pointer at the next revalidation", async () => {
    const { r2, cache, advance } = setup();
    r2.put("m/s.json", pointerText(1));
    await cache.load(r2.bucket, "s");
    r2.put("m/s.json", pointerText(2));
    expect((await cache.load(r2.bucket, "s")).pointer?.version).toBe(1);
    advance(REVALIDATE_MS);
    expect((await cache.load(r2.bucket, "s")).pointer?.version).toBe(2);
  });

  test("a shorter maxAgeMs revalidates a copy the default window would still serve", async () => {
    const { r2, cache, advance } = setup();
    r2.put("m/s.json", pointerText(1));
    await cache.load(r2.bucket, "s");
    r2.put("m/s.json", pointerText(2));
    advance(MISS_REVALIDATE_MS - 1);
    expect((await cache.load(r2.bucket, "s", { maxAgeMs: MISS_REVALIDATE_MS })).pointer?.version).toBe(1);
    expect(r2.reads).toHaveLength(1);
    advance(1);
    expect((await cache.load(r2.bucket, "s", { maxAgeMs: MISS_REVALIDATE_MS })).pointer?.version).toBe(2);
    // The new copy restarts the default window.
    advance(REVALIDATE_MS - 1);
    expect((await cache.load(r2.bucket, "s")).pointer?.version).toBe(2);
    expect(r2.reads).toHaveLength(2);
  });

  test("a shorter maxAgeMs shares the read in flight", async () => {
    const { r2, cache, advance } = setup();
    r2.put("m/s.json", pointerText(1));
    await cache.load(r2.bucket, "s");
    advance(REVALIDATE_MS);
    await Promise.all([
      cache.load(r2.bucket, "s"),
      cache.load(r2.bucket, "s", { maxAgeMs: MISS_REVALIDATE_MS }),
      cache.load(r2.bucket, "s", { maxAgeMs: MISS_REVALIDATE_MS }),
    ]);
    expect(r2.reads).toHaveLength(2);
  });

  test("a missing pointer is cached as no site, and found once it appears", async () => {
    const { r2, cache, advance } = setup();
    expect((await cache.load(r2.bucket, "s")).pointer).toBeNull();
    await cache.load(r2.bucket, "s");
    expect(r2.reads).toHaveLength(1);
    r2.put("m/s.json", pointerText(1));
    advance(REVALIDATE_MS);
    expect((await cache.load(r2.bucket, "s")).pointer?.version).toBe(1);
  });

  test("a deleted pointer takes the site down at the next revalidation", async () => {
    const { r2, cache, advance } = setup();
    r2.put("m/s.json", pointerText(1));
    await cache.load(r2.bucket, "s");
    r2.delete("m/s.json");
    advance(REVALIDATE_MS);
    expect((await cache.load(r2.bucket, "s")).pointer).toBeNull();
  });

  test("concurrent loads share one read", async () => {
    const { r2, cache } = setup();
    r2.put("m/s.json", pointerText(1));
    const loads = await Promise.all([1, 2, 3].map(() => cache.load(r2.bucket, "s")));
    expect(loads.every((l) => l.pointer?.version === 1)).toBe(true);
    expect(r2.reads).toHaveLength(1);
  });

  test("keys the cache by slug", async () => {
    const { r2, cache } = setup();
    r2.put("m/a.json", pointerText(1));
    r2.put("m/b.json", pointerText(2));
    expect((await cache.load(r2.bucket, "a")).pointer?.version).toBe(1);
    expect((await cache.load(r2.bucket, "b")).pointer?.version).toBe(2);
    expect(cache.size()).toBe(2);
  });

  test("an R2 failure rejects and is not cached", async () => {
    const { r2, cache } = setup();
    r2.put("m/s.json", pointerText(1));
    r2.fail(() => true);
    await expect(cache.load(r2.bucket, "s")).rejects.toThrow("unavailable");
    r2.fail(null);
    expect((await cache.load(r2.bucket, "s")).pointer?.version).toBe(1);
  });

  test("a malformed pointer rejects", async () => {
    const { r2, cache } = setup();
    r2.put("m/s.json", "{ not json");
    await expect(cache.load(r2.bucket, "s")).rejects.toBeInstanceOf(MalformedPointerError);
  });

  // A pointer text of about `bytes` bytes.
  const sized = (version: number, bytes: number) =>
    JSON.stringify({ v: 1, version, u: "user_1", files: {}, pad: "x".repeat(bytes - 60) });

  test("a pointer past MAX_POINTER_BYTES rejects without being cached", async () => {
    const { r2, cache } = setup();
    r2.put("m/s.json", sized(1, MAX_POINTER_BYTES + 100));
    await expect(cache.load(r2.bucket, "s")).rejects.toBeInstanceOf(MalformedPointerError);
    expect(cache.size()).toBe(0);
    expect(cache.loadingHeap()).toBe(0);
  });

  test("the cache is charged for a parsed pointer's heap, not its text length", async () => {
    const { r2, cache } = setup();
    const text = sized(1, 1_000_000);
    r2.put("m/s.json", text);
    await cache.load(r2.bucket, "s");
    expect(cache.cachedHeap()).toBe(cachedHeapOf(text));
    expect(cachedHeapOf(text)).toBeGreaterThanOrEqual(text.length * 2.5);
  });

  test("the cache holds no more estimated heap than its budget", async () => {
    const { r2, cache } = setup();
    const count = 20;
    for (let n = 0; n < count; n++) r2.put(`m/s${n}.json`, sized(1, 2_000_000));
    for (let n = 0; n < count; n++) await cache.load(r2.bucket, `s${n}`);
    expect(cache.cachedHeap()).toBeLessThanOrEqual(MAX_CACHED_HEAP);
    // 20 pointers of 2 MB are 40 MB of text alone, ~100 MB of heap parsed.
    expect(cache.size()).toBeLessThan(count);
    const fits = Math.floor(MAX_CACHED_HEAP / cachedHeapOf(sized(1, 2_000_000)));
    expect(cache.size()).toBeLessThanOrEqual(fits);
  });

  test("parallel loads of different sites are capped by memory; past it a load is refused until they finish", async () => {
    const { r2, cache } = setup();
    const size = 2_000_000;
    const fits = Math.floor(MAX_LOADING_HEAP / loadingHeapOf(size));
    expect(fits).toBeGreaterThanOrEqual(2);
    const count = fits + 3;
    for (let n = 0; n < count; n++) r2.put(`m/s${n}.json`, sized(1, size));
    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, n) => cache.load(r2.bucket, `s${n}`)),
    );
    const refused = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(fits);
    expect(refused).toHaveLength(count - fits);
    for (const r of refused) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(PointerBusyError);
    }
    // The reservations are all given back, so a retry loads.
    expect(cache.loadingHeap()).toBe(0);
    expect((await cache.load(r2.bucket, `s${count - 1}`)).pointer?.version).toBe(1);
  });

  test("a refused or failed load gives back its reservation", async () => {
    const { r2, cache } = setup();
    r2.put("m/s.json", "{ not json");
    await expect(cache.load(r2.bucket, "s")).rejects.toBeInstanceOf(MalformedPointerError);
    expect(cache.loadingHeap()).toBe(0);
  });
});
