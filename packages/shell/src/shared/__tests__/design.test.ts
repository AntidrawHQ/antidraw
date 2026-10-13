import { expect, test } from "vitest";
import { changesOf, previewCss, previewText, type Style } from "../design";

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
  mt: 0,
  mr: 0,
  mb: 0,
  ml: 0,
  hidden: false,
  opacity: 100,
  radius: 16,
  corners: [16, 16, 16, 16],
  fill: "#FFFFFF",
  fillA: 100,
  gradient: false,
  stroke: { color: "#E4E4E7", a: 100, w: 1 },
  shadow: null,
  shadowRest: [],
  weight: "400",
  size: 14,
  lh: 20,
  ls: 0,
  talign: "left",
  color: "#18181B",
  colorA: 100,
  content: null,
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

test("a full radius, no fill, and a border as the code would write it", () => {
  expect(previewCss(card, { ...card, radius: 48, fill: null, stroke: { color: "#000000", a: 50, w: 2 } })).toEqual({
    "border-radius": "9999px",
    "background-color": "transparent",
    border: "2px solid rgba(0, 0, 0, 0.5)",
  });
});

test("rounds only the corners that were rounded", () => {
  const top = { ...card, corners: [16, 16, 0, 0] as Style["corners"] };
  expect(previewCss(top, { ...top, radius: 24 })).toEqual({ "border-radius": "24px 24px 0px 0px" });
  const square = { ...card, radius: 0, corners: [0, 0, 0, 0] as Style["corners"] };
  expect(previewCss(square, { ...square, radius: 8 })).toEqual({ "border-radius": "8px" });
});

test("an edited shadow keeps the layers under it", () => {
  const shadowed = { ...card, shadow: { x: 0, y: 1, blur: 3, spread: 0, color: "#000000", a: 10 }, shadowRest: ["rgba(0, 0, 0, 0.1) 0px 1px 2px -1px"] };
  expect(previewCss(shadowed, { ...shadowed, shadow: { ...shadowed.shadow, y: 4 } })).toEqual({
    "box-shadow": "0px 4px 3px 0px rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 0px 1px 2px -1px",
  });
});

test("text and hiding: said to Claude, the text written in, hiding over the layout", () => {
  const label = { ...card, content: "Buy" };
  const now = { ...label, content: "Buy now", flow: "row" as const, hidden: true };
  expect(changesOf(label, now).map((c) => `${c.group.label}: ${c.from} → ${c.to}`)).toEqual([
    'Text: "Buy" → "Buy now"',
    "Auto layout: Vertical → Horizontal",
    "Visibility: Visible → Hidden",
  ]);
  expect(previewCss(label, now).display).toBe("none");
  expect(previewText(label, now)).toBe("Buy now");
  expect(previewText(label, { ...label, radius: 4 })).toBeUndefined();
});

test("writes only the alignment axis that changed: one left alone stays stretched, or spaced around", () => {
  const row = { ...card, flow: "row" as const };
  expect(previewCss(row, { ...row, main: "center" })).toEqual({ "justify-content": "center" });
  expect(previewCss(row, { ...row, cross: "end" })).toEqual({ "align-items": "flex-end" });
  expect(previewCss(row, { ...row, main: "end", cross: "center" })).toEqual({ "justify-content": "flex-end", "align-items": "center" });
});

test("a gap is written alone, and only along the flow where its two gaps differ", () => {
  const row = { ...card, flow: "row" as const };
  expect(previewCss(row, { ...row, gap: 16 })).toEqual({ gap: "16px" });
  expect(previewCss(row, { ...row, between: true })).toEqual({ "justify-content": "space-between" });
  const wrap = { ...card, flow: "wrap" as const, gap: 16, splitGap: true };
  expect(previewCss(wrap, { ...wrap, gap: 24 })).toEqual({ "column-gap": "24px" });
  const column = { ...card, splitGap: true };
  expect(previewCss(column, { ...column, gap: 24 })).toEqual({ "row-gap": "24px" });
});

test("a Fixed or Hug size isn't grown or based on 0 by its parent's flex (flex-1), along the parent's direction only", () => {
  const inRow = { ...card, wMode: "fill" as const, hMode: "fill" as const, parentFlex: "row" as const };
  const unflexed = { "flex-grow": "0", "flex-shrink": "0", "flex-basis": "auto" };
  expect(previewCss(inRow, { ...inRow, wMode: "fixed", w: 120 })).toEqual({ width: "120px", "min-width": "0px", "max-width": "none", ...unflexed });
  expect(previewCss(inRow, { ...inRow, wMode: "hug" })).toEqual({ width: "fit-content", ...unflexed });
  // Its height is across the row: flex has nothing to do with it.
  expect(previewCss(inRow, { ...inRow, hMode: "hug" })).toEqual({ height: "auto" });
  const inColumn = { ...inRow, parentFlex: "column" as const };
  expect(previewCss(inColumn, { ...inColumn, hMode: "fixed", h: 40 })).toEqual({ height: "40px", "min-height": "0px", "max-height": "none", ...unflexed });
  expect(previewCss(inColumn, { ...inColumn, wMode: "hug" })).toEqual({ width: "fit-content" });
});
