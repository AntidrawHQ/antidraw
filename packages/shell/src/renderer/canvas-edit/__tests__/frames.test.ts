import { describe, expect, test } from "vitest";
import { centredOn, copyName, offsetBy } from "../frames";

describe("copyName", () => {
  test("counts on from the name, and from a copy's", () => {
    const taken = new Set(["card", "cardcopy"]);
    expect([copyName("Card", taken), copyName("Card", taken), copyName("CardCopy2", taken)]).toEqual([
      "CardCopy2",
      "CardCopy3",
      "CardCopy4",
    ]);
  });

  test("a spaced name's copies are spaced", () => {
    const taken = new Set(["hero card"]);
    expect([copyName("Hero Card", taken), copyName("Hero Card", taken), copyName("Hero Card Copy", taken)]).toEqual([
      "Hero Card Copy",
      "Hero Card Copy 2",
      "Hero Card Copy 3",
    ]);
  });

  test("a name taken in another case is taken", () => {
    expect(copyName("Card", new Set(["card", "cardcopy"]))).toBe("CardCopy2");
  });

  test("a name that's only the suffix keeps it", () => {
    expect(copyName("Copy", new Set(["copy"]))).toBe("CopyCopy");
  });
});

describe("placing frames", () => {
  const layouts = [
    { componentName: "A", x: 13, y: 21, width: 300, height: 200 },
    { componentName: "B", x: 413, y: 61, width: 100, height: 100 },
  ];

  test("centred on a point, apart as they were, their corner on the grid", () => {
    expect(centredOn(layouts, { x: 1000, y: 1000 })).toEqual([
      { componentName: "A", x: 752, y: 904, width: 300, height: 200 },
      { componentName: "B", x: 1152, y: 944, width: 100, height: 100 },
    ]);
  });

  test("offset from where they were", () => {
    expect(offsetBy(layouts, 2).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 96, y: 104 },
      { x: 496, y: 144 },
    ]);
  });
});
