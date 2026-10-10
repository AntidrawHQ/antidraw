import {
  INSPECTOR_NS,
  INSPECTOR_PROTOCOL,
  SOURCE_ATTRIBUTE,
  USE_ATTRIBUTE,
  type ElementContext,
  type ElementInfo,
  type ElementRef,
  type Envelope,
  type FromFrame,
  type Sides,
  type ToFrame,
  type WalkDirection,
} from "./protocol"
import { markupOf, openingTag } from "./markup"
import { reactParent, renderedWithin } from "./react"

// The inspector's half that runs in a preview frame: it finds, measures and
// keeps track of elements for the canvas, which draws and owns the input.
// See protocol.ts. Only elements inside `container` (the component) count.

const USER_COMPONENTS_DIR = "src/components/user-components/"
const LOC_RE = /:\d+:\d+$/

// As the user reads it: innerText breaks between blocks, where textContent
// runs "Pro" and "Choose" together. Without it (an SVG), text by text.
const textOf = (el: Element) => {
  let text = el instanceof HTMLElement ? el.innerText : undefined
  if (text === undefined) {
    const parts: string[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue ?? "")
    text = parts.join(" ")
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 80)
}


const px = (v: string) => parseFloat(v) || 0
const sides = (cs: CSSStyleDeclaration, prop: (side: string) => string): Sides =>
  ["top", "right", "bottom", "left"].map((side) => px(cs.getPropertyValue(prop(side)))) as Sides

export function startInspector(container: HTMLElement, componentName: string): () => void {
  const ownFile = `${USER_COMPONENTS_DIR}${componentName}.tsx`
  // Where the canvas talks from; answers go only there.
  let canvasOrigin: string | null = null
  let selected: Element | null = null
  let selectedRef: ElementRef | null = null
  let lastSent = ""

  const post = (msg: FromFrame, origin = canvasOrigin) => {
    if (!origin) return
    window.parent.postMessage({ ns: INSPECTOR_NS, ...msg } satisfies Envelope<FromFrame>, origin)
  }

  // The component's elements: those inside the container, and those it
  // rendered into a portal (a dialog, a menu, a tooltip), which sit under
  // <body> in the DOM but under the component in React's tree.
  const inside = (el: Element | null): el is Element =>
    !!el && el !== container && (container.contains(el) || renderedWithin(el, container))

  // Its parent among them: the DOM parent, and at the top of a portal the
  // element the portal was rendered from.
  const parentOf = (el: Element): Element | null => {
    const parent = el.parentElement
    if (parent === container || inside(parent)) return parent
    return container.contains(el) ? null : reactParent(el, container)
  }

  // What's under a point, as DevTools sees it: pointer-events: none hides
  // nothing (a disabled button, the page behind an open modal dialog).
  const elementAt = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    const style = document.createElement("style")
    style.textContent = "* { pointer-events: auto !important; }"
    document.head.append(style)
    try {
      return document.elementsFromPoint(x, y).find(inside) ?? null
    } finally {
      style.remove()
    }
  }

  const withLoc = (loc: string) =>
    [...document.querySelectorAll(`[${SOURCE_ATTRIBUTE}="${CSS.escape(loc)}"]`)].filter(inside)

  // The child-index path from the container, or for an element in a portal
  // from <body>, marked by a leading -1.
  const refFor = (el: Element, text = textOf(el)): ElementRef => {
    const loc = el.getAttribute(SOURCE_ATTRIBUTE)
    const portaled = !container.contains(el)
    const root = portaled ? document.body : container
    const path: number[] = []
    for (let node: Element = el; node !== root && node.parentElement; node = node.parentElement)
      path.unshift([...node.parentElement.children].indexOf(node))
    if (portaled) path.unshift(-1)
    return { loc, index: loc ? withLoc(loc).indexOf(el) : 0, path, tag: el.localName, text }
  }

  // The element a ref names now: by source location, or by path. Either way
  // it must be the same kind of element: deleting a line moves the next
  // element up into the deleted one's location. Adding a line moves every
  // location below it, so the old one can name the element written above,
  // of the same kind: when the two disagree, the one whose text is still
  // the ref's wins, and the location otherwise (a sibling shown or hidden
  // moves the path, not the location).
  const find = (ref: ElementRef): Element | null => {
    const same = (el: Element | null | undefined): el is Element => inside(el ?? null) && el!.localName === ref.tag
    let byLoc: Element | null = null
    if (ref.loc) {
      const matches = withLoc(ref.loc)
      const hit = matches[ref.index] ?? (matches.length === 1 ? matches[0] : undefined)
      if (same(hit)) byLoc = hit
    }
    const portaled = ref.path[0] === -1
    let node: Element | undefined = portaled ? document.body : container
    for (const i of portaled ? ref.path.slice(1) : ref.path) node = node?.children[i]
    const byPath = same(node) ? node : null
    if (!byLoc || !byPath || byLoc === byPath || ref.text === undefined) return byLoc ?? byPath
    return textOf(byLoc) !== ref.text && textOf(byPath) === ref.text ? byPath : byLoc
  }

  const callsiteOf = (el: Element) => {
    for (let node: Element | null = el; inside(node); node = parentOf(node)) {
      const loc = node.getAttribute(SOURCE_ATTRIBUTE)
      if (loc && loc.replace(LOC_RE, "") === ownFile) return loc
    }
    return null
  }

  const infoFor = (el: Element): ElementInfo => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const text = textOf(el)
    return {
      ref: refFor(el, text),
      callsite: callsiteOf(el),
      tag: el.localName,
      id: el.id,
      classes: [...el.classList].slice(0, 4),
      text,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      margin: sides(cs, (s) => `margin-${s}`),
      border: sides(cs, (s) => `border-${s}-width`),
      padding: sides(cs, (s) => `padding-${s}`),
    }
  }

  // ── What an agent is told about an element ───────────────────────────────

  // The nearest element at or around `el` that `has` says is stamped.
  const nearest = (el: Element, has: (node: Element) => boolean) => {
    for (let node: Element | null = el; inside(node); node = parentOf(node)) if (has(node)) return node
    return null
  }
  const located = (node: Element) => node.hasAttribute(SOURCE_ATTRIBUTE)
  const stamped = (node: Element) => located(node) || node.hasAttribute(USE_ATTRIBUTE)

  // The uses on the way out from `el`: the places in the code it's rendered
  // inside of, as far as they reached the DOM.
  const usesAround = (el: Element) => {
    const uses: string[] = []
    for (let node = parentOf(el); inside(node); node = parentOf(node)) {
      const use = node.getAttribute(USE_ATTRIBUTE)
      if (use) uses.push(use)
    }
    return uses.join("\0")
  }

  // The others written in the same place and used from the same places: a
  // .map()'s items, and the items of a list inside one, counted as one list.
  // A shared component's button used twice is used from two places, and so
  // is everything inside it. (One that doesn't pass its props on carries no
  // use: the same place twice is taken as a list.)
  const repeatOf = (el: Element): ElementContext["repeat"] => {
    const anchor = nearest(el, stamped)
    if (!anchor) return null
    const loc = anchor.getAttribute(SOURCE_ATTRIBUTE)
    const use = anchor.getAttribute(USE_ATTRIBUTE)
    const around = usesAround(anchor)
    const matches = (
      loc
        ? withLoc(loc).filter((m) => m.getAttribute(USE_ATTRIBUTE) === use)
        : [...document.querySelectorAll(`[${USE_ATTRIBUTE}="${CSS.escape(use!)}"]`)].filter(
            (m) => inside(m) && !located(m),
          )
    ).filter((m) => usesAround(m) === around)
    return matches.length > 1 ? { index: matches.indexOf(anchor), count: matches.length } : null
  }

  const contextFor = (el: Element): ElementContext => {
    const info = infoFor(el)
    const around = located(el) ? null : nearest(el, located)
    return {
      viewport: [window.innerWidth, window.innerHeight],
      element: el.localName + (el.id ? `#${el.id}` : "") + [...el.classList].slice(0, 6).map((c) => `.${c}`).join(""),
      html: markupOf(el),
      within: around && openingTag(around),
      repeat: repeatOf(el),
      size: [Math.round(info.rect.width), Math.round(info.rect.height)],
      margin: info.margin,
      border: info.border,
      padding: info.padding,
    }
  }

  // ── The selection, followed across re-renders ──────────────────────────

  let frame = 0

  // Its box, read every frame as DevTools does: it moves without the DOM
  // changing (web fonts swapping in, a transition, a layout settling after a
  // reload), and only a full re-measure when it does.
  let watching = 0
  let lastBox = ""
  const boxOf = (el: Element) => {
    const r = el.getBoundingClientRect()
    return `${r.x},${r.y},${r.width},${r.height}`
  }
  const watchBox = () => {
    watching = requestAnimationFrame(watchBox)
    if (!selected) return
    const box = boxOf(selected)
    if (box === lastBox) return
    lastBox = box
    schedule()
  }

  const select = (el: Element | null) => {
    selected = el
    if (!el) {
      selectedRef = null
      lastSent = ""
      cancelAnimationFrame(watching)
      watching = 0
      return null
    }
    lastBox = boxOf(el)
    if (!watching) watching = requestAnimationFrame(watchBox)
    const info = infoFor(el)
    selectedRef = info.ref
    lastSent = JSON.stringify(info)
    return info
  }

  const check = () => {
    frame = 0
    if (!selected || !selectedRef) return
    // React kept the node (Fast Refresh usually does) or replaced it.
    const el = selected.isConnected ? selected : find(selectedRef)
    if (!el) {
      select(null)
      post({ type: "selection-lost" })
      return
    }
    selected = el
    const info = infoFor(el)
    selectedRef = info.ref
    const key = JSON.stringify(info)
    if (key === lastSent) return
    lastSent = key
    post({ type: "selection-changed", info })
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(check)
  }
  // The whole body: the component's portals are outside the container.
  const mutations = new MutationObserver(schedule)
  mutations.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  window.addEventListener("resize", schedule)

  const walk = (dir: WalkDirection) => {
    if (!selected) return null
    const next = {
      parent: parentOf(selected),
      child: selected.firstElementChild,
      next: selected.nextElementSibling,
      prev: selected.previousElementSibling,
    }[dir]
    return inside(next) ? next : selected
  }

  // ── Messages ───────────────────────────────────────────────────────────

  const ready = (id?: number, origin?: string) =>
    post(
      {
        type: "ready",
        id,
        protocol: INSPECTOR_PROTOCOL,
        componentName,
        tagged: !!container.querySelector(`[${SOURCE_ATTRIBUTE}]`),
      },
      origin,
    )

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.data?.ns !== INSPECTOR_NS) return
    canvasOrigin = event.origin
    const msg = event.data as ToFrame
    switch (msg.type) {
      case "hello":
        return ready(msg.id)
      case "hit": {
        const el = elementAt(msg.x, msg.y)
        return post({ type: "hover", id: msg.id, info: el && infoFor(el) })
      }
      case "select-at":
        return post({ type: "selected", id: msg.id, info: select(elementAt(msg.x, msg.y)) })
      case "select":
        return post({ type: "selected", id: msg.id, info: select(msg.ref && find(msg.ref)) })
      case "walk":
        return post({ type: "selected", id: msg.id, info: select(walk(msg.dir)) })
      case "context":
        return post({
          type: "context",
          id: msg.id,
          contexts: msg.refs.map((ref) => {
            const el = find(ref)
            return el && contextFor(el)
          }),
        })
    }
  }
  window.addEventListener("message", onMessage)

  // A canvas that loaded before this started learns of it here. Only "ready"
  // goes to any parent: it says no more than the frame's URL does.
  ready(undefined, "*")

  return () => {
    window.removeEventListener("message", onMessage)
    window.removeEventListener("resize", schedule)
    mutations.disconnect()
    cancelAnimationFrame(frame)
    cancelAnimationFrame(watching)
  }
}
