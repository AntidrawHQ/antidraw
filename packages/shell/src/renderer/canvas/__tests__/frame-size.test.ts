import { expect, it } from "vitest";
import { clampSize, presetAt } from "../frame-size";

// Which preset a frame's size reads as in its toolbar's size menu.

it("reads a size as its preset, a phone or tablet turned on its side, or none", () => {
  const read = (w: number, h: number | null) => {
    const at = presetAt({ w, h });
    return at ? `${at.preset.id}${at.turned ? " (turned)" : ""}` : "custom";
  };
  expect({
    tablet: read(768, 1024),
    turnedTablet: read(1024, 768),
    turnedMobile: read(844, 390),
    // Laptops and desktops don't turn.
    turnedLaptop: read(800, 1280),
    auto: read(768, null),
    other: read(769, 1024),
  }).toMatchInlineSnapshot(`
    {
      "auto": "custom",
      "other": "custom",
      "tablet": "tablet",
      "turnedLaptop": "custom",
      "turnedMobile": "mobile (turned)",
      "turnedTablet": "tablet (turned)",
    }
  `);
});

it("keeps a size whole and at least 50, with no largest", () => {
  expect([clampSize(12), clampSize(767.6), clampSize(9000)]).toEqual([50, 768, 9000]);
});
