import { describe, expect, it } from "vitest";
import { framesInReadingOrder, openFrame, openName, pageViewport, searchWith } from "./frames";

const at = (componentName: string, x: number, y: number, width = 800, height = 600) => ({
  componentName,
  x,
  y,
  width,
  height,
});
const named = (...names: string[]) => names.map((name) => ({ name }));

describe("framesInReadingOrder", () => {
  it("reads rows from the top, each from its left", () => {
    const frames = framesInReadingOrder({
      components: named("A", "B", "C", "D"),
      layouts: [at("D", 900, 700), at("B", 900, 0), at("C", 0, 700), at("A", 0, 0)],
    });
    expect(frames.map((frame) => frame.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps frames set side by side at slightly different heights in one row", () => {
    const frames = framesInReadingOrder({
      components: named("Left", "Right", "Below"),
      // Right starts a little higher than Left, yet is read after it.
      layouts: [at("Left", 0, 40), at("Right", 900, 0), at("Below", 0, 700)],
    });
    expect(frames.map((frame) => frame.name)).toEqual(["Left", "Right", "Below"]);
  });

  it("puts components the canvas hasn't placed last, as the file lists them", () => {
    const frames = framesInReadingOrder({
      components: named("New", "Placed", "Newer"),
      layouts: [at("Placed", 0, 0)],
    });
    expect(frames.map((frame) => frame.name)).toEqual(["Placed", "New", "Newer"]);
    expect(frames[1]).toEqual({ name: "New", width: 400, height: 300, sized: false });
  });

  it("leaves out a layout whose component is gone", () => {
    const frames = framesInReadingOrder({ components: named("A"), layouts: [at("A", 0, 0), at("Gone", 900, 0)] });
    expect(frames.map((frame) => frame.name)).toEqual(["A"]);
  });

  it("carries a frame's size, and says when it's only the canvas's default", () => {
    const frames = framesInReadingOrder({
      components: named("Sized", "Default"),
      layouts: [at("Sized", 0, 0, 1280, 860), at("Default", 1400, 0, 400, 300)],
    });
    expect(frames).toEqual([
      { name: "Sized", width: 1280, height: 860, sized: true },
      { name: "Default", width: 400, height: 300, sized: false },
    ]);
  });
});

describe("pageViewport", () => {
  it("is as wide as a frame wider than the screen, zoomed out to fit it", () => {
    const viewport = pageViewport(1280, 390);
    expect(viewport?.width).toBe(1280);
    expect(viewport?.scale).toBeCloseTo(0.3047, 4);
  });

  it("leaves the page alone for a frame the screen has room for", () => {
    expect(pageViewport(320, 390)).toBeNull();
    expect(pageViewport(390, 390)).toBeNull();
  });

  it("goes no further out than a browser zooms", () => {
    expect(pageViewport(8000, 390)).toEqual({ width: 3900, scale: 0.1 });
  });

  it("leaves the page alone before the screen's width is known", () => {
    expect(pageViewport(1280, 0)).toBeNull();
  });
});

describe("the open component in the URL", () => {
  const frames = framesInReadingOrder({ components: named("Hero", "Pricing Page"), layouts: [] });

  it("is the list when the URL names none", () => {
    expect(openFrame("", frames)).toBeNull();
    expect(openFrame("?utm_source=slack", frames)).toBeNull();
  });

  it("is the frame the URL names", () => {
    expect(openFrame("?c=Pricing%20Page", frames)).toBe(1);
  });

  it("is read by name, whether or not the snapshot has the component", () => {
    expect(openName("?c=Pricing%20Page")).toBe("Pricing Page");
    expect(openName("?c=Gone")).toBe("Gone");
    expect(openName("?utm_source=slack")).toBeNull();
  });

  it("is the list when the URL names a component the snapshot doesn't have", () => {
    expect(openFrame("?c=Gone", frames)).toBeNull();
  });

  it("is written and removed without touching other parameters", () => {
    expect(searchWith("?utm_source=slack", "Pricing Page")).toBe("?utm_source=slack&c=Pricing+Page");
    expect(openFrame(searchWith("", "Pricing Page"), frames)).toBe(1);
    expect(searchWith("?utm_source=slack&c=Hero", null)).toBe("?utm_source=slack");
    expect(searchWith("?c=Hero", null)).toBe("");
  });
});
