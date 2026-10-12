import { expect, test } from "vitest";
import { changesOf, previewCss, type Style } from "../design";

// An element's styles as the Design panel edits them: what changed, said as
// a design tool would, and the CSS that previews it.

const card: Style = {
  flow: "column",
  main: "start",
  cross: "start",
  between: false,
  gap: 12,
  wMode: "fixed",
  w: 300,
  hMode: "hug",
  h: 220,
  pt: 24,
  pr: 24,
  pb: 24,
  pl: 24,
  clip: false,
  opacity: 100,
  radius: 16,
  fill: "#FFFFFF",
  fillA: 100,
  stroke: { color: "#E4E4E7", a: 100, w: 1, at: "inside" },
  shadow: null,
  blur: 0,
  bgBlur: 0,
  font: "Geist",
  weight: "400",
  size: 14,
  lh: 20,
  ls: 0,
  talign: "left",
  color: "#18181B",
  colorA: 100,
};

test("previews only what changed, so the rest stays as the code has it", () => {
  expect(previewCss(card, { ...card, radius: 24, pt: 32, pb: 32 })).toEqual({
    padding: "32px 24px 32px 24px",
    "border-radius": "24px",
  });
  expect(previewCss(card, card)).toEqual({});
});

test("says each change as a design tool does", () => {
  expect(changesOf(card, { ...card, radius: 48, wMode: "fill", fill: "#F4F4F5", fillA: 80 }).map((c) => `${c.group.label}: ${c.from} → ${c.to}`)).toEqual([
    "Width: Fixed 300 → Fill",
    "Corner radius: 16 → Full",
    "Fill: #FFFFFF → #F4F4F5 80%",
  ]);
});

test("a full radius, no fill and a stroke over a border", () => {
  expect(previewCss(card, { ...card, radius: 48, fill: null, stroke: { color: "#000000", a: 50, w: 2, at: "center" } })).toEqual({
    "border-radius": "9999px",
    background: "none",
    // The border it had hides while the outline stands in for it.
    "border-color": "transparent",
    outline: "2px solid rgba(0, 0, 0, 0.5)",
    "outline-offset": "-1px",
  });
});
