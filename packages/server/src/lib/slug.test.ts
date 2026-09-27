import { describe, expect, it } from "vitest";
import { isAllowedSlug, makeSlug, randomSuffix, RESERVED_SLUGS, slugBase } from "./slug";

describe("slugBase", () => {
  it.each([
    ["Café Ünïcode", "cafe-unicode"],
    ["  My   Canvas!! ", "my-canvas"],
    ["", "canvas"],
    ["!!!", "canvas"],
    ["日本語", "canvas"],
    ["admin", "canvas"],
    ["Default Canvas", "canvas"],
    ["xn--abc", "xn-abc"],
  ])("%j -> %j", (name, base) => {
    expect(slugBase(name)).toBe(base);
  });

  it("cuts long names to 40 characters without a trailing dash", () => {
    expect(slugBase("a".repeat(60))).toBe("a".repeat(40));
    const base = slugBase(`${"a".repeat(39)} tail`);
    expect(base).toBe("a".repeat(39));
    expect(base.length).toBeLessThanOrEqual(40);
  });
});

describe("makeSlug", () => {
  it("appends the suffix", () => {
    expect(makeSlug("Acme Canvas", () => "x7k2p")).toBe("acme-canvas-x7k2p");
  });

  it("always produces an allowed slug", () => {
    const names = ["", "Café", "a".repeat(100), "admin", "--x--", "Ω≈ç√", "www", "0"];
    for (let i = 0; i < 1000; i++) {
      const slug = makeSlug(names[i % names.length]);
      expect(isAllowedSlug(slug), slug).toBe(true);
    }
  });

  it("draws the suffix from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) expect(randomSuffix()).toMatch(/^[a-hjkmnp-z2-9]{5}$/);
  });
});

describe("isAllowedSlug", () => {
  it("refuses punycode, reserved names and non-labels", () => {
    expect(isAllowedSlug("xn--80ak6aa92e")).toBe(false);
    for (const reserved of RESERVED_SLUGS) expect(isAllowedSlug(reserved)).toBe(false);
    expect(isAllowedSlug("-abc")).toBe(false);
    expect(isAllowedSlug("abc-")).toBe(false);
    expect(isAllowedSlug("ABC")).toBe(false);
    expect(isAllowedSlug("a".repeat(64))).toBe(false);
    expect(isAllowedSlug("acme-canvas-x7k2p")).toBe(true);
  });
});
