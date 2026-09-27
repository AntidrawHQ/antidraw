import { describe, expect, test } from "vitest";
import {
  contentKey,
  createPointerCache,
  entryFor,
  MalformedPointerError,
  parsePointer,
  pointerKey,
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
    });
  });

  test("a path the site does not have", () => {
    expect(entryFor(pointer, "missing.js")).toBeUndefined();
  });

  test("only the pointer's own paths: none from Object.prototype", () => {
    expect(entryFor(pointer, "constructor")).toBeUndefined();
    expect(entryFor(pointer, "__proto__")).toBeUndefined();
    expect(entryFor(pointer, "hasOwnProperty")).toBeUndefined();
  });

  test.each(["bad-sha", "bad-size", "bad-type", "not-an-object"])("%s is malformed", (path) => {
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
});
