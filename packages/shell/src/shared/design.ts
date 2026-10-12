// An element's styles as the Design panel edits them (renderer/design), said
// as a design tool would: auto layout, sizing, padding, fill, stroke, effects
// and type, not CSS. The frame's agent reads them off the element
// (agent/design.ts) and previews an edit as CSS (previewCss); the server
// tells Claude what changed (changesOf). No imports: the agent is built on
// its own, without the app's aliases.

export type Align = "start" | "center" | "end";
export type Flow = "none" | "column" | "row" | "wrap";
export type Sizing = "fixed" | "hug" | "fill";
export type StrokeAt = "inside" | "center" | "outside";
export type TextAlign = "left" | "center" | "right" | "justify";
export type Stroke = { color: string; a: number; w: number; at: StrokeAt };
export type Shadow = { x: number; y: number; blur: number; spread: number; color: string; a: number };

// Colors are "#RRGGBB" with their opacity apart, 0–100. A line height of 0
// is "Auto" (normal).
export type Style = {
  flow: Flow;
  main: Align;
  cross: Align;
  between: boolean;
  gap: number;
  wMode: Sizing;
  w: number;
  hMode: Sizing;
  h: number;
  pt: number;
  pr: number;
  pb: number;
  pl: number;
  clip: boolean;
  opacity: number;
  radius: number;
  fill: string | null;
  fillA: number;
  stroke: Stroke | null;
  shadow: Shadow | null;
  blur: number;
  bgBlur: number;
  font: string;
  weight: string;
  size: number;
  lh: number;
  ls: number;
  talign: TextAlign;
  color: string;
  colorA: number;
};

// A radius this big or more is "Full".
export const FULL = 48;

/* ── Changes: what the panel has done, said as Figma would ─────────────── */

export const FLOW_LABEL: Record<Flow, string> = { none: "None", column: "Vertical", row: "Horizontal", wrap: "Wrap" };
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
export const sides = (s: Style) =>
  s.pt === s.pb && s.pl === s.pr ? (s.pt === s.pl ? r1(s.pt) : `${r1(s.pt)} ${r1(s.pl)}`) : [s.pt, s.pr, s.pb, s.pl].map(r1).join(" ");
export const color = (hex: string | null, a: number) => (hex ? `${hex}${a < 100 ? ` ${a}%` : ""}` : "None");

export type Group = { key: string; label: string; keys: (keyof Style)[]; fmt: (s: Style) => string };
export const GROUPS: Group[] = [
  { key: "flow", label: "Auto layout", keys: ["flow"], fmt: (s) => FLOW_LABEL[s.flow] },
  { key: "align", label: "Alignment", keys: ["main", "cross"], fmt: (s) => `${s.main} · ${s.cross}` },
  { key: "gap", label: "Gap", keys: ["gap", "between"], fmt: (s) => (s.between ? "Auto" : r1(s.gap)) },
  { key: "w", label: "Width", keys: ["w", "wMode"], fmt: (s) => (s.wMode === "fixed" ? `Fixed ${r1(s.w)}` : SIZING[s.wMode]) },
  { key: "h", label: "Height", keys: ["h", "hMode"], fmt: (s) => (s.hMode === "fixed" ? `Fixed ${r1(s.h)}` : SIZING[s.hMode]) },
  { key: "pad", label: "Padding", keys: ["pt", "pr", "pb", "pl"], fmt: sides },
  { key: "clip", label: "Clip content", keys: ["clip"], fmt: (s) => (s.clip ? "On" : "Off") },
  { key: "opacity", label: "Opacity", keys: ["opacity"], fmt: (s) => `${s.opacity}%` },
  { key: "radius", label: "Corner radius", keys: ["radius"], fmt: (s) => (s.radius >= FULL ? "Full" : r1(s.radius)) },
  { key: "font", label: "Font", keys: ["font"], fmt: (s) => s.font },
  { key: "weight", label: "Weight", keys: ["weight"], fmt: (s) => weightName(s.weight) },
  { key: "size", label: "Font size", keys: ["size"], fmt: (s) => r1(s.size) },
  { key: "lh", label: "Line height", keys: ["lh"], fmt: (s) => (s.lh ? r1(s.lh) : "Auto") },
  { key: "ls", label: "Letter spacing", keys: ["ls"], fmt: (s) => r1(s.ls) },
  { key: "talign", label: "Text align", keys: ["talign"], fmt: (s) => s.talign },
  { key: "color", label: "Text color", keys: ["color", "colorA"], fmt: (s) => color(s.color, s.colorA) },
  { key: "fill", label: "Fill", keys: ["fill", "fillA"], fmt: (s) => color(s.fill, s.fillA) },
  { key: "stroke", label: "Stroke", keys: ["stroke"], fmt: (s) => (s.stroke ? `${s.stroke.w} ${color(s.stroke.color, s.stroke.a)} ${s.stroke.at}` : "None") },
  {
    key: "shadow",
    label: "Drop shadow",
    keys: ["shadow"],
    fmt: (s) => (s.shadow ? `${s.shadow.x} ${s.shadow.y} blur ${s.shadow.blur} spread ${s.shadow.spread}` : "None"),
  },
  { key: "blur", label: "Layer blur", keys: ["blur"], fmt: (s) => (s.blur ? r1(s.blur) : "None") },
  { key: "bgBlur", label: "Background blur", keys: ["bgBlur"], fmt: (s) => (s.bgBlur ? r1(s.bgBlur) : "None") },
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

// Each group as the declarations that show it. `base` is what the element
// had: a stroke read off its border hides that border while an outline
// stands in.
const CSS: Record<string, (s: Style, base: Style) => Record<string, string | undefined>> = {
  flow: (s) =>
    s.flow === "none"
      ? { display: "block" }
      : { display: "flex", "flex-direction": s.flow === "column" ? "column" : "row", "flex-wrap": s.flow === "wrap" ? "wrap" : "nowrap" },
  align: (s) => ({ "justify-content": s.between ? "space-between" : FLEX[s.main], "align-items": FLEX[s.cross] }),
  gap: (s) => ({ gap: `${s.gap}px`, "justify-content": s.between ? "space-between" : FLEX[s.main] }),
  w: (s) =>
    s.wMode === "fixed"
      ? { width: `${s.w}px`, "min-width": "0px", "max-width": "none" }
      : s.wMode === "hug"
        ? { width: "fit-content" }
        : { width: "auto", "align-self": "stretch" },
  h: (s) =>
    s.hMode === "fixed" ? { height: `${s.h}px`, "min-height": "0px", "max-height": "none" } : s.hMode === "hug" ? { height: "auto" } : { height: "100%" },
  pad: (s) => ({ padding: `${s.pt}px ${s.pr}px ${s.pb}px ${s.pl}px` }),
  clip: (s) => ({ overflow: s.clip ? "hidden" : "visible" }),
  opacity: (s) => ({ opacity: String(s.opacity / 100) }),
  radius: (s) => ({ "border-radius": s.radius >= FULL ? "9999px" : `${s.radius}px` }),
  font: (s) => ({ "font-family": `"${s.font.replace(/"/g, "")}", system-ui, sans-serif` }),
  weight: (s) => ({ "font-weight": s.weight }),
  size: (s) => ({ "font-size": `${s.size}px` }),
  lh: (s) => ({ "line-height": s.lh ? `${s.lh}px` : "normal" }),
  ls: (s) => ({ "letter-spacing": `${s.ls}px` }),
  talign: (s) => ({ "text-align": s.talign }),
  color: (s) => ({ color: rgba(s.color, s.colorA) }),
  fill: (s) => (s.fill ? { "background-color": rgba(s.fill, s.fillA), "background-image": "none" } : { background: "none" }),
  stroke: (s, base) => ({
    ...(base.stroke && { "border-color": "transparent" }),
    ...(s.stroke
      ? {
          outline: `${s.stroke.w}px solid ${rgba(s.stroke.color, s.stroke.a)}`,
          "outline-offset": `${s.stroke.at === "inside" ? -s.stroke.w : s.stroke.at === "center" ? -s.stroke.w / 2 : 0}px`,
        }
      : { outline: "none" }),
  }),
  shadow: (s) => ({
    "box-shadow": s.shadow ? `${s.shadow.x}px ${s.shadow.y}px ${s.shadow.blur}px ${s.shadow.spread}px ${rgba(s.shadow.color, s.shadow.a)}` : "none",
  }),
  blur: (s) => ({ filter: s.blur ? `blur(${s.blur}px)` : "none" }),
  bgBlur: (s) => ({ "backdrop-filter": s.bgBlur ? `blur(${s.bgBlur}px)` : "none" }),
};

// The declarations that show an edit: only what it changed, so the rest of
// the element stays as its code has it.
export const previewCss = (base: Style, now: Style): Record<string, string> =>
  Object.fromEntries(
    changedGroups(base, now)
      .flatMap((g) => Object.entries(CSS[g.key]!(now, base)))
      .filter((d): d is [string, string] => d[1] !== undefined),
  );
