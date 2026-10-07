import {
  INSPECTOR_NS,
  INSPECTOR_PROTOCOL,
  SOURCE_ATTRIBUTE,
  type ElementContext,
  type ElementInfo,
  type ElementRef,
  type Envelope,
  type FromFrame,
  type Sides,
  type ToFrame,
  type WalkDirection,
} from "./protocol"
import { keysOf, ownersOf } from "./react"

// The inspector's half that runs in a preview frame: it finds, measures and
// keeps track of elements for the canvas, which draws and owns the input.
// See protocol.ts. Only elements inside `container` (the component) count.

const USER_COMPONENTS_DIR = "src/components/user-components/"
const LOC_RE = /:\d+:\d+$/

// The attributes that say what an element is (data-slot names a shadcn part)
// or what state it's in.
const ATTRIBUTES = [
  "data-slot",
  "role",
  "aria-label",
  "name",
  "type",
  "placeholder",
  "alt",
  "title",
  "href",
  "src",
  "data-state",
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-current",
  "disabled",
  "checked",
  "open",
]

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

const clip = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const fileOf = (loc: string) => loc.replace(LOC_RE, "")

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

  const inside = (el: Element | null): el is Element =>
    !!el && el !== container && container.contains(el)

  const elementAt = (x: number, y: number) =>
    Number.isFinite(x) && Number.isFinite(y)
      ? (document.elementsFromPoint(x, y).find(inside) ?? null)
      : null

  const withLoc = (loc: string) =>
    container.querySelectorAll(`[${SOURCE_ATTRIBUTE}="${CSS.escape(loc)}"]`)

  const refFor = (el: Element, text = textOf(el)): ElementRef => {
    const loc = el.getAttribute(SOURCE_ATTRIBUTE)
    const path: number[] = []
    for (let node: Element = el; node !== container && node.parentElement; node = node.parentElement)
      path.unshift([...node.parentElement.children].indexOf(node))
    return { loc, index: loc ? [...withLoc(loc)].indexOf(el) : 0, path, tag: el.localName, text }
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
    let node: Element | undefined = container
    for (const i of ref.path) node = node?.children[i]
    const byPath = same(node) ? node : null
    if (!byLoc || !byPath || byLoc === byPath || ref.text === undefined) return byLoc ?? byPath
    return textOf(byLoc) !== ref.text && textOf(byPath) === ref.text ? byPath : byLoc
  }

  const callsiteOf = (el: Element) => {
    for (let node: Element | null = el; inside(node); node = node.parentElement) {
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

  const stampedAround = (el: Element) => {
    for (let node = el.parentElement; inside(node); node = node.parentElement)
      if (node.hasAttribute(SOURCE_ATTRIBUTE)) return node
    return null
  }

  // From `from` down to `el`, as a selector.
  const pathFrom = (from: Element, el: Element) => {
    const steps: string[] = []
    for (let node = el; node !== from && node.parentElement; node = node.parentElement) {
      const like = [...node.parentElement.children].filter((c) => c.localName === node.localName)
      steps.unshift(like.length > 1 ? `${node.localName}:nth-of-type(${like.indexOf(node) + 1})` : node.localName)
    }
    return steps.join(" > ")
  }

  // The nearest location at or around `el` that `owns` says is its code.
  const ownedLoc = (el: Element, owns: (node: Element) => boolean) => {
    for (let node: Element | null = el; inside(node); node = node.parentElement) {
      const loc = node.getAttribute(SOURCE_ATTRIBUTE)
      if (loc && owns(node)) return loc
    }
    return null
  }

  const componentsOf = (el: Element): ElementContext["components"] => {
    const owners = ownersOf(el, container)
    if (owners.length) {
      const all = owners.map((o) => ({ name: o.name, loc: ownedLoc(el, o.owns) }))
      return all.filter((c, i) => c.loc || i === 0 || i === all.length - 1)
    }
    // No React internals to read: each file the stamps around it pass
    // through on the way out, up to the previewed component's.
    const files: ElementContext["components"] = []
    for (let node: Element | null = el; inside(node); node = node.parentElement) {
      const loc = node.getAttribute(SOURCE_ATTRIBUTE)
      if (!loc || (files[0]?.loc && fileOf(files[0].loc) === fileOf(loc))) continue
      files.unshift({ name: fileOf(loc).split("/").pop()!.replace(/\.[jt]sx$/, ""), loc })
      if (fileOf(loc) === ownFile) break
    }
    return files
  }

  const contextFor = (el: Element): ElementContext => {
    const info = infoFor(el)
    const loc = el.getAttribute(SOURCE_ATTRIBUTE)
    const anchor = loc ? el : stampedAround(el)
    // The others rendered from the same place by the same places around it:
    // a shared component's button used twice isn't a list. Nor is one
    // written twice in the same place: a list's items differ by key. (Without
    // React's data there are no keys; the same place twice is taken as a list.)
    const where = (node: Element) => componentsOf(node).map((c) => c.loc).join(" ")
    const here = anchor && where(anchor)
    const matches = anchor
      ? [...withLoc(anchor.getAttribute(SOURCE_ATTRIBUTE)!)].filter((m) => m === anchor || where(m) === here)
      : []
    const listed =
      matches.length > 1 &&
      (!ownersOf(anchor!, container).length || new Set(matches.map((m) => keysOf(m, container).join("\0"))).size > 1)
    const attributes: Record<string, string> = {}
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute(name)
      if (value !== null) attributes[name] = clip(value)
    }
    // React sets the checked attribute once; the property is what's on screen.
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (el.checked) attributes.checked = ""
      else delete attributes.checked
    }
    return {
      viewport: [window.innerWidth, window.innerHeight],
      element: el.localName + (el.id ? `#${el.id}` : "") + [...el.classList].slice(0, 6).map((c) => `.${c}`).join(""),
      text: info.text,
      loc,
      within: !loc && anchor ? { loc: anchor.getAttribute(SOURCE_ATTRIBUTE)!, path: pathFrom(anchor, el) } : null,
      components: componentsOf(el),
      repeat:
        listed
          ? { index: matches.indexOf(anchor!), count: matches.length, keys: keysOf(el, container) }
          : null,
      attributes,
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
  const mutations = new MutationObserver(schedule)
  mutations.observe(container, { subtree: true, childList: true, attributes: true, characterData: true })
  window.addEventListener("resize", schedule)

  const walk = (dir: WalkDirection) => {
    if (!selected) return null
    const next = {
      parent: selected.parentElement,
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
