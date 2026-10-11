import type { Sides } from "./protocol"

// What the agent puts over the page while a tool is on: a layer that takes
// the pointer from it, the box model of the element under the pointer (as
// DevTools draws it), and an outline around the one picked. In a shadow
// root the page's styles don't reach, and in the top layer, over the page's
// own dialogs and popovers.

const COLORS = {
  margin: "rgba(246, 178, 107, 0.5)",
  border: "rgba(255, 229, 153, 0.5)",
  padding: "rgba(147, 196, 125, 0.5)",
  content: "rgba(111, 168, 220, 0.5)",
  picked: "#3b82f6",
}

const HOST = [
  "all: initial",
  "position: fixed",
  "inset: 0",
  "width: 0",
  "height: 0",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "background: transparent",
  "overflow: visible",
  "z-index: 2147483647",
  "display: block",
]
  .map((d) => `${d} !important`)
  .join(";")

const CSS = `
  .catcher { position: fixed; inset: 0; cursor: crosshair; pointer-events: auto; background: transparent; }
  .box { position: absolute; left: 0; top: 0; box-sizing: border-box; pointer-events: none; border-style: solid; border-width: 0; }
  [hidden] { display: none; }
`

const px = (v: string) => parseFloat(v) || 0
const sidesOf = (cs: CSSStyleDeclaration, prop: (side: string) => string) =>
  ["top", "right", "bottom", "left"].map((side) => px(cs.getPropertyValue(prop(side)))) as Sides

export type Overlay = ReturnType<typeof createOverlay>

export function createOverlay() {
  const host = document.createElement("antidraw-agent")
  host.setAttribute("style", HOST)
  const shadow = host.attachShadow({ mode: "open" })
  const style = document.createElement("style")
  style.textContent = CSS
  const catcher = document.createElement("div")
  catcher.className = "catcher"
  const box = (color: string, fill = false) => {
    const el = document.createElement("div")
    el.className = "box"
    el.hidden = true
    el.style[fill ? "background" : "borderColor"] = color
    return el
  }
  const [margin, border, padding, content] = [
    box(COLORS.margin),
    box(COLORS.border),
    box(COLORS.padding),
    box(COLORS.content, true),
  ]
  const outline = box(COLORS.picked)
  shadow.append(style, catcher, margin, border, padding, content, outline)

  // Hit-testing sees what DevTools does: pointer-events: none hides nothing
  // (a disabled button, the page behind an open modal dialog). The page
  // can't take the pointer meanwhile anyway: the catcher has it.
  const everything = document.createElement("style")
  everything.textContent = "* { pointer-events: auto !important; }"

  const place = (el: HTMLElement, x: number, y: number, w: number, h: number, widths?: Sides) => {
    el.hidden = false
    el.style.transform = `translate(${x}px, ${y}px)`
    el.style.width = `${Math.max(0, w)}px`
    el.style.height = `${Math.max(0, h)}px`
    if (widths) el.style.borderWidth = widths.map((v) => `${Math.max(0, v)}px`).join(" ")
  }

  const drawBoxModel = (el: Element | null) => {
    const r = el?.isConnected ? el.getBoundingClientRect() : null
    if (!el || !r || (!r.width && !r.height)) {
      for (const b of [margin, border, padding, content]) b.hidden = true
      return
    }
    const cs = getComputedStyle(el)
    const m = sidesOf(cs, (s) => `margin-${s}`).map((v) => Math.max(0, v)) as Sides
    const b = sidesOf(cs, (s) => `border-${s}-width`)
    const p = sidesOf(cs, (s) => `padding-${s}`)
    place(margin, r.x - m[3], r.y - m[0], r.width + m[1] + m[3], r.height + m[0] + m[2], m)
    place(border, r.x, r.y, r.width, r.height, b)
    place(padding, r.x + b[3], r.y + b[0], r.width - b[1] - b[3], r.height - b[0] - b[2], p)
    place(
      content,
      r.x + b[3] + p[3],
      r.y + b[0] + p[0],
      r.width - b[1] - b[3] - p[1] - p[3],
      r.height - b[0] - b[2] - p[0] - p[2],
    )
  }

  const drawOutline = (el: Element | null, zoom: number) => {
    if (!el?.isConnected) {
      outline.hidden = true
      return
    }
    const r = el.getBoundingClientRect()
    place(outline, r.x, r.y, r.width, r.height)
    // Two screen pixels at the canvas's zoom.
    outline.style.outline = `${2 / zoom}px solid ${COLORS.picked}`
  }

  const showOnTop = () => {
    try {
      host.popover = "manual"
      if (host.matches(":popover-open")) host.hidePopover()
      host.showPopover()
    } catch {
      // No top layer: the z-index still puts it over most of the page.
    }
  }

  // A modal <dialog> the page opens makes everything outside it inert, the
  // overlay too, and goes over it. So the overlay goes inside the topmost
  // one, shown again above it, and back out when it closes.
  let holder: Element | null = null
  const topModal = () => {
    try {
      return [...document.querySelectorAll("dialog:modal")].at(-1) ?? null
    } catch {
      return null
    }
  }

  return {
    host,
    catcher,
    // Is this the overlay (what a hit-test finds first while it's up)?
    owns: (el: Element) => el === host,
    show() {
      holder = topModal()
      if (host.parentElement !== (holder ?? document.documentElement)) (holder ?? document.documentElement).append(host)
      if (!everything.isConnected) document.head.append(everything)
      showOnTop()
    },
    keepOnTop() {
      const modal = topModal()
      if (modal === holder && host.isConnected) return
      holder = modal
      ;(modal ?? document.documentElement).append(host)
      showOnTop()
    },
    hide() {
      holder = null
      host.remove()
      everything.remove()
    },
    draw(hovered: Element | null, picked: Element | null, zoom: number) {
      drawBoxModel(hovered)
      drawOutline(picked, zoom)
    },
  }
}
