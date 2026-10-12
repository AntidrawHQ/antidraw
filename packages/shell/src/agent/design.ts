import { EDIT_ATTRIBUTE, type ElementRef, type PreviewItem } from "./protocol"
import type { Align, Corners, Flow, Shadow, Sizing, Stroke, Style, TextAlign } from "../shared/design"

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

// The first shadow that shows, which the panel edits, and the other layers
// as they are (Tailwind stacks two or three, and empty ones under them).
const shadowsOf = (v: string): { shadow: Shadow | null; rest: string[] } => {
  if (v === "none") return { shadow: null, rest: [] }
  let shadow: Shadow | null = null
  const rest: string[] = []
  for (const one of splitTop(v, ",")) {
    const tokens = splitTop(one, " ")
    const isLength = (t: string) => /^-?[\d.]+(px)?$/.test(t)
    const lengths = tokens.filter(isLength).map(px)
    const color = colorOf(tokens.find((t) => !isLength(t) && t !== "inset") ?? "")
    // Nothing to see: left out.
    if (!color || lengths.length < 2) continue
    if (shadow || tokens.includes("inset")) {
      rest.push(one)
      continue
    }
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths
    shadow = { x: round(x), y: round(y), blur: round(blur), spread: round(spread), color: color.hex, a: color.a }
  }
  return { shadow, rest }
}

const strokeOf = (cs: CSSStyleDeclaration): Stroke | null => {
  const border = px(cs.borderTopWidth)
  if (!(border > 0) || cs.borderTopStyle === "none") return null
  const c = colorOf(cs.borderTopColor)
  return c && { color: c.hex, a: c.a, w: round(border) }
}

const flowOf = (cs: CSSStyleDeclaration): Flow =>
  cs.display.includes("grid")
    ? "grid"
    : !cs.display.includes("flex")
      ? "none"
      : cs.flexWrap === "wrap"
        ? "wrap"
        : cs.flexDirection.startsWith("column")
          ? "column"
          : "row"

const TEXT_ALIGN: Record<string, TextAlign> = { center: "center", right: "right", end: "right", justify: "justify" }

// Its size with `prop` set to `value`, for a moment: set and taken back in
// the same task, so nothing is painted, and the page's own style kept.
const sizedAs = (el: Element, prop: "width" | "height", value: string) => {
  const style = (el as HTMLElement).style
  if (!style) return null
  const was = style.getPropertyValue(prop)
  const priority = style.getPropertyPriority(prop)
  style.setProperty(prop, value, "important")
  const r = el.getBoundingClientRect()
  if (was) style.setProperty(prop, was, priority)
  else style.removeProperty(prop)
  return prop === "width" ? r.width : r.height
}

// How it's sized. CSS doesn't keep whether a size was written or worked
// out, so it's measured: a size its content gives it hugs, one its parent
// gives it (or a flex row's grow) fills, and only one neither gives it is
// fixed.
const sizingOf = (el: Element, cs: CSSStyleDeclaration) => {
  const r = el.getBoundingClientRect()
  const [w, h] = [round(r.width), round(r.height)]
  const parent = el.parentElement
  if (!parent) return { wMode: "fill" as Sizing, hMode: "hug" as Sizing, w, h }
  const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1
  const ps = getComputedStyle(parent)
  const pr = parent.getBoundingClientRect()
  const innerW = pr.width - px(ps.paddingLeft) - px(ps.paddingRight) - px(ps.borderLeftWidth) - px(ps.borderRightWidth)
  const innerH = pr.height - px(ps.paddingTop) - px(ps.paddingBottom) - px(ps.borderTopWidth) - px(ps.borderBottomWidth)
  const flex = ps.display.includes("flex")
  const row = flex && ps.flexDirection.startsWith("row")
  const grows = px(cs.flexGrow) > 0
  const fit = sizedAs(el, "width", "fit-content")
  const autoW = sizedAs(el, "width", "auto")
  const autoH = sizedAs(el, "height", "auto")
  const wMode: Sizing = row
    ? grows
      ? "fill"
      : near(fit, r.width)
        ? "hug"
        : "fixed"
    : cs.display.startsWith("inline")
      ? near(fit, r.width)
        ? "hug"
        : "fixed"
      : near(autoW, r.width)
        ? near(fit, r.width) && !near(innerW, r.width)
          ? "hug"
          : "fill"
        : near(fit, r.width)
          ? "hug"
          : "fixed"
  const hMode: Sizing = flex && !row && grows ? "fill" : near(autoH, r.height) ? "hug" : near(innerH, r.height) ? "fill" : "fixed"
  return { wMode, hMode, w, h }
}

// Text written right in it, not only inside its children.
const holdsText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim())
// Its one run of text, which the panel can rewrite; none when it has two
// ("$24", a <span>, " / month") or none.
const textNodeOf = (el: Element) => {
  const runs = [...el.childNodes].filter((n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.nodeValue?.trim())
  return runs.length === 1 ? runs[0]! : null
}

export function readStyle(el: Element): { style: Style; text: boolean } {
  const cs = getComputedStyle(el)
  const flow = flowOf(cs)
  const fill = colorOf(cs.backgroundColor)
  const text = colorOf(cs.color) ?? { hex: "#000000", a: 100 }
  const corners = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((c) =>
    round(px(c)),
  ) as Corners
  const radius = Math.max(...corners)
  const { shadow, rest } = shadowsOf(cs.boxShadow)
  return {
    text: holdsText(el),
    style: {
      flow,
      main: alignOf(cs.justifyContent),
      cross: alignOf(cs.alignItems),
      between: cs.justifyContent === "space-between",
      gap: round(px(flow === "column" ? cs.rowGap : cs.columnGap)),
      ...sizingOf(el, cs),
      pt: round(px(cs.paddingTop)),
      pr: round(px(cs.paddingRight)),
      pb: round(px(cs.paddingBottom)),
      pl: round(px(cs.paddingLeft)),
      mt: round(px(cs.marginTop)),
      mr: round(px(cs.marginRight)),
      mb: round(px(cs.marginBottom)),
      ml: round(px(cs.marginLeft)),
      hidden: cs.display === "none",
      opacity: Math.round(px(cs.opacity) * 100),
      radius: radius >= 9999 ? 48 : radius,
      corners,
      fill: fill?.hex ?? null,
      fillA: fill?.a ?? 100,
      gradient: cs.backgroundImage !== "none" && cs.backgroundImage !== "",
      stroke: strokeOf(cs),
      shadow,
      shadowRest: rest,
      weight: cs.fontWeight,
      size: round(px(cs.fontSize)),
      lh: cs.lineHeight === "normal" ? 0 : round(px(cs.lineHeight)),
      ls: cs.letterSpacing === "normal" ? 0 : round(px(cs.letterSpacing)),
      talign: TEXT_ALIGN[cs.textAlign] ?? "left",
      color: text.hex,
      colorA: text.a,
      content: textNodeOf(el)?.nodeValue?.trim() ?? null,
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
// which items have none, whenever that changes. An item's `text` is written
// into its element's one run of text, and the run's own put back when the
// preview goes. React keeps the node and writes it again only when the text
// in the code changes: that write is the run's own text from then on, even
// when it's the same as the preview's (an Apply writes the previewed text).
export function createPreviews(find: (ref: ElementRef) => Element | null, onMissing: (keys: string[]) => void) {
  let items: PreviewItem[] = []
  let found: (Element | null)[] = []
  let marked = new Map<Element, string>()
  // Each run of text written, with its own text: what the page last wrote
  // there. The page's writes are heard here; this one's own are taken back
  // from the queue as they're made.
  const written = new Map<Text, string>()
  const pageWrites = new MutationObserver((records) => {
    for (const r of records) if (written.has(r.target as Text)) written.set(r.target as Text, (r.target as Text).nodeValue ?? "")
  })
  const write = (node: Text, text: string) => {
    node.nodeValue = text
    pageWrites.takeRecords()
  }
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
    // The text, the later item's where two write one run, its own spaces kept.
    const texts = new Map<Text, string>()
    found.forEach((el, i) => {
      const text = items[i]!.text
      const node = el && text !== undefined ? textNodeOf(el) : null
      if (!node) return
      if (!written.has(node)) {
        written.set(node, node.nodeValue ?? "")
        pageWrites.observe(node, { characterData: true })
      }
      const was = written.get(node)!
      texts.set(node, was.replace(was.trim(), () => text!))
    })
    for (const [node, own] of written)
      if (!texts.has(node)) {
        if (node.nodeValue !== own) write(node, own)
        written.delete(node)
      }
    for (const [node, text] of texts) if (node.nodeValue !== text) write(node, text)
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
    for (const [node, own] of written) write(node, own)
    written.clear()
    pageWrites.disconnect()
    for (const [el] of marked) el.removeAttribute(EDIT_ATTRIBUTE)
    marked.clear()
    sheet.remove()
  }

  return { set, heal, stop }
}
