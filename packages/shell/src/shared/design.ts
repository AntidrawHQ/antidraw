// An element's styles as the Design panel edits them (renderer/design), said
// as a design tool would: auto layout, sizing, spacing, fill, stroke, shadow
// and type, not CSS. Only what maps onto a component's code: a web border,
// not a stroke's position; the element's own text; spacing on Tailwind's 4px
// scale. The frame's agent reads them off the element (agent/design.ts) and
// previews an edit as CSS (previewCss); the server tells Claude what changed
// (changesOf). No imports: the agent is built on its own, without the app's
// aliases.

export type Align = "start" | "center" | "end";
// "grid": a CSS grid, which the panel shows and can leave, but doesn't lay out.
export type Flow = "none" | "column" | "row" | "wrap" | "grid";
export type Sizing = "fixed" | "hug" | "fill";
export type TextAlign = "left" | "center" | "right" | "justify";
// A border, as web code has it: width and color, on every side.
export type Stroke = { color: string; a: number; w: number };
export type Shadow = { x: number; y: number; blur: number; spread: number; color: string; a: number };
export type Corners = [topLeft: number, topRight: number, bottomRight: number, bottomLeft: number];

// Colors are "#RRGGBB" with their opacity apart, 0–100. A line height of 0
// is "Auto" (normal).
export type Style = {
  flow: Flow;
  main: Align;
  cross: Align;
  between: boolean;
  gap: number;
  // Its row and column gaps differ: `gap` is the one along its flow (the
  // column gap, but in a column), and an edit sets only that one.
  splitGap?: boolean;
  // Its parent's direction, when the parent is a flex box: the size its
  // flex-grow and flex-basis are for.
  parentFlex?: "row" | "column";
  wMode: Sizing;
  w: number;
  hMode: Sizing;
  h: number;
  pt: number;
  pr: number;
  pb: number;
  pl: number;
  mt: number;
  mr: number;
  mb: number;
  ml: number;
  hidden: boolean;
  opacity: number;
  // The largest corner's; `corners`, each as the element has them. An edit
  // rounds the corners that were rounded (all, if none was).
  radius: number;
  corners: Corners;
  fill: string | null;
  fillA: number;
  // Its background is a gradient (or an image): Fill shows it, can't edit it.
  gradient: boolean;
  stroke: Stroke | null;
  // The shadow the panel edits: the first that shows. `shadowRest`, the
  // others as CSS (Tailwind stacks two or three), kept under it.
  shadow: Shadow | null;
  shadowRest: string[];
  weight: string;
  size: number;
  lh: number;
  ls: number;
  talign: TextAlign;
  color: string;
  colorA: number;
  // The text written right in it, when it has one run of it; null otherwise.
  content: string | null;
};

// A radius this big or more is "Full".
export const FULL = 48;

/* ── Changes: what the panel has done, said as Figma would ─────────────── */

export const FLOW_LABEL: Record<Flow, string> = { none: "None", column: "Vertical", row: "Horizontal", wrap: "Wrap", grid: "Grid" };
export const SIZING: Record<Sizing, string> = { fixed: "Fixed", hug: "Hug", fill: "Fill" };
export const WEIGHTS = [
  ["300", "Light"],
  ["400", "Regular"],
  ["500", "Medium"],
  ["600", "Semibold"],
  ["700", "Bold"],
  ["800", "Extra bold"],
] as const;
export const weightName = (w: string) => WEIGHTS.find(([x]) => x === w)?.[1] ?? w;
export const r1 = (n: number) => String(Math.round(n * 10) / 10);
const sidesOf = (t: number, r: number, b: number, l: number) =>
  t === b && l === r ? (t === l ? r1(t) : `${r1(t)} ${r1(l)}`) : [t, r, b, l].map(r1).join(" ");
export const color = (hex: string | null, a: number) => (hex ? `${hex}${a < 100 ? ` ${a}%` : ""}` : "None");

export type Group = { key: string; label: string; keys: (keyof Style)[]; fmt: (s: Style) => string };
export const GROUPS: Group[] = [
  { key: "content", label: "Text", keys: ["content"], fmt: (s) => JSON.stringify(s.content ?? "") },
  { key: "flow", label: "Auto layout", keys: ["flow"], fmt: (s) => FLOW_LABEL[s.flow] },
  { key: "align", label: "Alignment", keys: ["main", "cross"], fmt: (s) => `${s.main} · ${s.cross}` },
  { key: "gap", label: "Gap", keys: ["gap", "between"], fmt: (s) => (s.between ? "Auto" : r1(s.gap)) },
  { key: "w", label: "Width", keys: ["w", "wMode"], fmt: (s) => (s.wMode === "fixed" ? `Fixed ${r1(s.w)}` : SIZING[s.wMode]) },
  { key: "h", label: "Height", keys: ["h", "hMode"], fmt: (s) => (s.hMode === "fixed" ? `Fixed ${r1(s.h)}` : SIZING[s.hMode]) },
  { key: "pad", label: "Padding", keys: ["pt", "pr", "pb", "pl"], fmt: (s) => sidesOf(s.pt, s.pr, s.pb, s.pl) },
  { key: "margin", label: "Margin", keys: ["mt", "mr", "mb", "ml"], fmt: (s) => sidesOf(s.mt, s.mr, s.mb, s.ml) },
  { key: "opacity", label: "Opacity", keys: ["opacity"], fmt: (s) => `${s.opacity}%` },
  { key: "radius", label: "Corner radius", keys: ["radius"], fmt: (s) => (s.radius >= FULL ? "Full" : r1(s.radius)) },
  { key: "weight", label: "Weight", keys: ["weight"], fmt: (s) => weightName(s.weight) },
  { key: "size", label: "Font size", keys: ["size"], fmt: (s) => r1(s.size) },
  { key: "lh", label: "Line height", keys: ["lh"], fmt: (s) => (s.lh ? r1(s.lh) : "Auto") },
  { key: "ls", label: "Letter spacing", keys: ["ls"], fmt: (s) => r1(s.ls) },
  { key: "talign", label: "Text align", keys: ["talign"], fmt: (s) => s.talign },
  { key: "color", label: "Text color", keys: ["color", "colorA"], fmt: (s) => color(s.color, s.colorA) },
  { key: "fill", label: "Fill", keys: ["fill", "fillA"], fmt: (s) => color(s.fill, s.fillA) },
  { key: "stroke", label: "Border", keys: ["stroke"], fmt: (s) => (s.stroke ? `${r1(s.stroke.w)} ${color(s.stroke.color, s.stroke.a)}` : "None") },
  {
    key: "shadow",
    label: "Drop shadow",
    keys: ["shadow"],
    fmt: (s) => (s.shadow ? `${s.shadow.x} ${s.shadow.y} blur ${s.shadow.blur} spread ${s.shadow.spread} ${color(s.shadow.color, s.shadow.a)}` : "None"),
  },
  // Last: hiding it wins over its layout's display.
  { key: "hidden", label: "Visibility", keys: ["hidden"], fmt: (s) => (s.hidden ? "Hidden" : "Visible") },
];

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The groups an edit changed on one element.
export const changedGroups = (base: Style, now: Style) => GROUPS.filter((g) => g.keys.some((k) => !same(base[k], now[k])));

export type Change = { group: Group; from: string; to: string };
export const changesOf = (base: Style, now: Style): Change[] =>
  changedGroups(base, now).map((group) => ({ group, from: group.fmt(base), to: group.fmt(now) }));

/* ── As CSS, for the preview ───────────────────────────────────────────── */

export const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha / 100})`;
};

const FLEX: Record<Align, string> = { start: "flex-start", center: "center", end: "flex-end" };
const px = (n: number) => `${n}px`;
const justify = (s: Style) => (s.between ? "space-between" : FLEX[s.main]);
// A size set as it is, not grown, shrunk or based on 0 (Tailwind's flex-1),
// where it's the size its parent flexes: the width unless that's a column.
const unflexed = (s: Style, size: "w" | "h") =>
  (size === "w" ? s.parentFlex !== "column" : s.parentFlex === "column") && { "flex-grow": "0", "flex-shrink": "0", "flex-basis": "auto" };

// Each group as the declarations that show it. `base` is what the element
// had: only what changed is written, so an axis left alone (stretched, or
// spaced around) stays as the code has it. Text isn't CSS: the agent writes
// it into the element (PreviewItem's `text`).
const CSS: Record<string, (s: Style, base: Style) => Record<string, string | undefined>> = {
  content: () => ({}),
  flow: (s) =>
    s.flow === "none"
      ? { display: "block" }
      : s.flow === "grid"
        ? { display: "grid" }
        : { display: "flex", "flex-direction": s.flow === "column" ? "column" : "row", "flex-wrap": s.flow === "wrap" ? "wrap" : "nowrap" },
  align: (s, base) => ({
    ...((s.main !== base.main || s.between !== base.between) && { "justify-content": justify(s) }),
    ...(s.cross !== base.cross && { "align-items": FLEX[s.cross] }),
  }),
  gap: (s, base) => ({
    ...(s.gap !== base.gap && { [!base.splitGap ? "gap" : s.flow === "column" ? "row-gap" : "column-gap"]: px(s.gap) }),
    ...(s.between !== base.between && s.flow !== "grid" && { "justify-content": justify(s) }),
  }),
  w: (s) =>
    s.wMode === "fixed"
      ? { width: px(s.w), "min-width": "0px", "max-width": "none", ...unflexed(s, "w") }
      : s.wMode === "hug"
        ? { width: "fit-content", ...unflexed(s, "w") }
        : { width: "auto", "align-self": "stretch", "flex-grow": "1" },
  h: (s) =>
    s.hMode === "fixed"
      ? { height: px(s.h), "min-height": "0px", "max-height": "none", ...unflexed(s, "h") }
      : s.hMode === "hug"
        ? { height: "auto", ...unflexed(s, "h") }
        : { height: "100%", "align-self": "stretch" },
  pad: (s) => ({ padding: `${px(s.pt)} ${px(s.pr)} ${px(s.pb)} ${px(s.pl)}` }),
  margin: (s) => ({ margin: `${px(s.mt)} ${px(s.mr)} ${px(s.mb)} ${px(s.ml)}` }),
  opacity: (s) => ({ opacity: String(s.opacity / 100) }),
  radius: (s, base) => {
    const r = s.radius >= FULL ? 9999 : s.radius;
    const rounded = base.corners.some((c) => c > 0);
    const corners = base.corners.map((c) => px(!rounded || c > 0 ? r : 0));
    return { "border-radius": new Set(corners).size === 1 ? corners[0]! : corners.join(" ") };
  },
  weight: (s) => ({ "font-weight": s.weight }),
  size: (s) => ({ "font-size": px(s.size) }),
  lh: (s) => ({ "line-height": s.lh ? px(s.lh) : "normal" }),
  ls: (s) => ({ "letter-spacing": px(s.ls) }),
  talign: (s) => ({ "text-align": s.talign }),
  color: (s) => ({ color: rgba(s.color, s.colorA) }),
  fill: (s) => ({ "background-color": s.fill ? rgba(s.fill, s.fillA) : "transparent" }),
  stroke: (s) =>
    s.stroke ? { border: `${px(s.stroke.w)} solid ${rgba(s.stroke.color, s.stroke.a)}` } : { "border-width": "0px", "border-style": "none" },
  shadow: (s) => ({
    "box-shadow": s.shadow
      ? [`${px(s.shadow.x)} ${px(s.shadow.y)} ${px(s.shadow.blur)} ${px(s.shadow.spread)} ${rgba(s.shadow.color, s.shadow.a)}`, ...s.shadowRest].join(", ")
      : "none",
  }),
  hidden: (s) => ({ display: s.hidden ? "none" : undefined }),
};

// The declarations that show an edit: only what it changed, so the rest of
// the element stays as its code has it.
export const previewCss = (base: Style, now: Style): Record<string, string> =>
  Object.fromEntries(
    changedGroups(base, now)
      .flatMap((g) => Object.entries(CSS[g.key]!(now, base)))
      .filter((d): d is [string, string] => d[1] !== undefined),
  );

// The element's text, where an edit changed it: the agent writes it in.
export const previewText = (base: Style, now: Style) => (now.content !== null && now.content !== base.content ? now.content : undefined);
