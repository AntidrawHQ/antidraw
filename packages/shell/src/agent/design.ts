import { EDIT_ATTRIBUTE, type ElementRef, type PreviewItem } from "./protocol"
import type { Align, Flow, Shadow, Sizing, Stroke, Style, TextAlign } from "../shared/design"

// The Design panel's side in the frame: an element's styles read as the
// panel shows them (shared/design.ts), and its edits shown on the page before
// any code changes. An edit is shown from a sheet of the agent's own, on an
// attribute it puts on the element, never in the element's own style, which
// React writes. React keeps the attribute on a node it keeps; a node it
// replaces gets it again (heal).

const px = (v: string) => parseFloat(v) || 0
const round = (n: number) => Math.round(n * 10) / 10

/* ── Colors ────────────────────────────────────────────────────────────── */

// Whatever the page writes (rgb(), oklch(), a name), as the screen has it:
// painted once and read back.
let paint: CanvasRenderingContext2D | null = null
const channels = (c: string): [number, number, number, number] | null => {
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/.exec(c)
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? px(rgb[4]) / 100 : px(rgb[4])
    return [px(rgb[1]!), px(rgb[2]!), px(rgb[3]!), a]
  }
  paint ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!paint) return null
  paint.clearRect(0, 0, 1, 1)
  paint.fillStyle = "#000"
  paint.fillStyle = c
  paint.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data
  return [r!, g!, b!, a! / 255]
}
const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0").toUpperCase()
// "#RRGGBB" and its opacity, 0–100; null where nothing shows.
const colorOf = (c: string): { hex: string; a: number } | null => {
  const ch = channels(c)
  if (!ch || ch[3] === 0) return null
  return { hex: `#${hex(ch[0])}${hex(ch[1])}${hex(ch[2])}`, a: Math.round(ch[3] * 100) }
}

/* ── Reading an element ────────────────────────────────────────────────── */

const ALIGN: Record<string, Align> = { center: "center", "flex-end": "end", end: "end", right: "end", "self-end": "end" }
const alignOf = (v: string): Align => ALIGN[v] ?? "start"

// Split at the top level only: a color's own commas and spaces stay in it.
const splitTop = (v: string, by: string) => {
  const parts: string[] = []
  let depth = 0
  let at = 0
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "(") depth++
    else if (v[i] === ")") depth--
    else if (v[i] === by && !depth) {
      parts.push(v.slice(at, i))
      at = i + 1
    }
  }
  parts.push(v.slice(at))
  return parts.map((p) => p.trim()).filter(Boolean)
}

// The first shadow that shows (Tailwind lays empty ones under its own).
const shadowOf = (v: string): Shadow | null => {
  if (v === "none") return null
  for (const one of splitTop(v, ",")) {
    const tokens = splitTop(one, " ")
    if (tokens.includes("inset")) continue
    const lengths = tokens.filter((t) => /^-?[\d.]+(px)?$/.test(t)).map(px)
    const color = colorOf(tokens.find((t) => !/^-?[\d.]+(px)?$/.test(t) && t !== "inset") ?? "")
    if (!color || lengths.length < 2) continue
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths
    return { x: round(x), y: round(y), blur: round(blur), spread: round(spread), color: color.hex, a: color.a }
  }
  return null
}

const strokeOf = (cs: CSSStyleDeclaration): Stroke | null => {
  const border = px(cs.borderTopWidth)
  if (border > 0 && cs.borderTopStyle !== "none") {
    const c = colorOf(cs.borderTopColor)
    if (c) return { color: c.hex, a: c.a, w: round(border), at: "inside" }
  }
  const outline = px(cs.outlineWidth)
  if (outline > 0 && cs.outlineStyle !== "none") {
    const c = colorOf(cs.outlineColor)
    const offset = px(cs.outlineOffset)
    if (c) return { color: c.hex, a: c.a, w: round(outline), at: offset <= -outline ? "inside" : offset < 0 ? "center" : "outside" }
  }
  return null
}

const flowOf = (cs: CSSStyleDeclaration): Flow =>
  !cs.display.includes("flex") ? "none" : cs.flexWrap === "wrap" ? "wrap" : cs.flexDirection.startsWith("column") ? "column" : "row"

const blurOf = (v: string) => round(px(/blur\(([^)]+)\)/.exec(v)?.[1] ?? "0"))

const TEXT_ALIGN: Record<string, TextAlign> = { center: "center", right: "right", end: "right", justify: "justify" }

// How it's sized, as near as the page says: CSS doesn't keep whether a
// width was written or worked out. Filling: as wide (tall) as its parent
// gives it, or growing in its flex row (column). Hugging: inline, or a flex
// item that doesn't grow. Otherwise fixed.
const sizingOf = (el: Element, cs: CSSStyleDeclaration) => {
  const r = el.getBoundingClientRect()
  const parent = el.parentElement
  if (!parent) return { wMode: "fixed" as Sizing, hMode: "hug" as Sizing, w: round(r.width), h: round(r.height) }
  const ps = getComputedStyle(parent)
  const pr = parent.getBoundingClientRect()
  const innerW = pr.width - px(ps.paddingLeft) - px(ps.paddingRight) - px(ps.borderLeftWidth) - px(ps.borderRightWidth)
  const innerH = pr.height - px(ps.paddingTop) - px(ps.paddingBottom) - px(ps.borderTopWidth) - px(ps.borderBottomWidth)
  const flex = ps.display.includes("flex")
  const row = flex && ps.flexDirection.startsWith("row")
  const grows = px(cs.flexGrow) > 0
  const inline = cs.display.startsWith("inline")
  const wide = Math.abs(r.width - innerW) < 1
  const wMode: Sizing = row ? (grows ? "fill" : "hug") : !inline && wide ? "fill" : inline || flex ? "hug" : "fixed"
  const hMode: Sizing = flex && !row && grows ? "fill" : row && Math.abs(r.height - innerH) < 1 && cs.alignSelf !== "center" ? "fill" : "hug"
  return { wMode, hMode, w: round(r.width), h: round(r.height) }
}

// Text written right in it, not only inside its children.
const holdsText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim())

export function readStyle(el: Element): { style: Style; text: boolean } {
  const cs = getComputedStyle(el)
  const flow = flowOf(cs)
  const row = flow === "row" || flow === "wrap"
  const fill = colorOf(cs.backgroundColor)
  const text = colorOf(cs.color) ?? { hex: "#000000", a: 100 }
  const radius = px(cs.borderTopLeftRadius)
  return {
    text: holdsText(el),
    style: {
      flow,
      main: alignOf(cs.justifyContent),
      cross: alignOf(cs.alignItems),
      between: cs.justifyContent === "space-between",
      gap: round(px(row ? cs.columnGap : cs.rowGap)),
      ...sizingOf(el, cs),
      pt: round(px(cs.paddingTop)),
      pr: round(px(cs.paddingRight)),
      pb: round(px(cs.paddingBottom)),
      pl: round(px(cs.paddingLeft)),
      clip: cs.overflow.includes("hidden") || cs.overflow.includes("clip"),
      opacity: Math.round(px(cs.opacity) * 100),
      radius: radius >= 9999 ? 48 : round(radius),
      fill: fill?.hex ?? null,
      fillA: fill?.a ?? 100,
      stroke: strokeOf(cs),
      shadow: shadowOf(cs.boxShadow),
      blur: blurOf(cs.filter),
      bgBlur: blurOf(cs.backdropFilter),
      font: (cs.fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim(),
      weight: cs.fontWeight,
      size: round(px(cs.fontSize)),
      lh: cs.lineHeight === "normal" ? 0 : round(px(cs.lineHeight)),
      ls: cs.letterSpacing === "normal" ? 0 : round(px(cs.letterSpacing)),
      talign: TEXT_ALIGN[cs.textAlign] ?? "left",
      color: text.hex,
      colorA: text.a,
    },
  }
}

/* ── Previews ──────────────────────────────────────────────────────────── */

// Each item's declarations on its key, in the items' order, so a later one
// wins where two set the same: the shell lists sets being applied before
// the edits still pending. Important, and the attribute thrice, over the
// page's own rules.
const ruleFor = (item: PreviewItem) => {
  const one = `[${EDIT_ATTRIBUTE}~="${CSS.escape(item.key)}"]`
  const body = Object.entries(item.css)
    .filter(([prop]) => /^[a-z-]+$/.test(prop))
    .map(([prop, value]) => `${prop}: ${value.replace(/[;{}]/g, "")} !important;`)
    .join(" ")
  return `${one}${one}${one} { ${body} }`
}

// The previews in this page. `find` names an element now; `onMissing` hears
// which items have none, whenever that changes.
export function createPreviews(find: (ref: ElementRef) => Element | null, onMissing: (keys: string[]) => void) {
  let items: PreviewItem[] = []
  let found: (Element | null)[] = []
  let marked = new Map<Element, string>()
  // Nothing said until there are previews.
  let lastMissing = "[]"
  const sheet = document.createElement("style")
  sheet.setAttribute("data-antidraw-agent", "")

  const heal = () => {
    found = items.map((item, i) => {
      const el = found[i]
      return el?.isConnected ? el : find(item.ref)
    })
    const want = new Map<Element, string>()
    found.forEach((el, i) => el && want.set(el, [want.get(el), items[i]!.key].filter(Boolean).join(" ")))
    // Only what differs: each write is a mutation, which brings heal back.
    for (const [el] of marked) if (!want.has(el)) el.removeAttribute(EDIT_ATTRIBUTE)
    for (const [el, keys] of want) if (el.getAttribute(EDIT_ATTRIBUTE) !== keys) el.setAttribute(EDIT_ATTRIBUTE, keys)
    marked = want
    if (items.length && !sheet.isConnected) document.head.append(sheet)
    const missing = items.filter((_, i) => !found[i]).map((item) => item.key)
    const key = JSON.stringify(missing)
    if (key !== lastMissing) {
      lastMissing = key
      onMissing(missing)
    }
  }

  const set = (next: PreviewItem[]) => {
    items = next
    found = []
    sheet.textContent = next.map(ruleFor).join("\n")
    if (!next.length) sheet.remove()
    // Said again in answer, changed or not.
    lastMissing = ""
    heal()
  }

  const stop = () => {
    for (const [el] of marked) el.removeAttribute(EDIT_ATTRIBUTE)
    marked.clear()
    sheet.remove()
  }

  return { set, heal, stop }
}
