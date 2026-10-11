import {
  AGENT_NS,
  SOURCE_ATTRIBUTE,
  type ElementContext,
  type ElementInfo,
  type ElementRef,
  type Envelope,
  type FromFrame,
  type Rect,
  type Sides,
  type ToFrame,
  type Tool,
  type WalkDirection,
  type WheelMode,
} from "./protocol"
import { markupOf, openingTag } from "./markup"
import { createOverlay } from "./overlay"
import { reactParent, renderedWithin } from "./react"

// The shell's agent in a preview frame: it finds, measures and keeps track
// of elements for the shell, and while one of the shell's tools is on, takes
// the pointer and picks them, drawing what it picks over the page. See
// protocol.ts. Only elements inside `container` (the component) count.

const USER_COMPONENTS_DIR = "src/components/user-components/"
const LOC_RE = /:\d+:\d+$/
const fileOf = (loc: string) => loc.replace(LOC_RE, "")

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
  // Where the shell talks from; answers go only there.
  let canvasOrigin: string | null = null
  let selected: Element | null = null
  let selectedRef: ElementRef | null = null
  let lastSent = ""

  const post = (msg: FromFrame, origin = canvasOrigin) => {
    if (!origin) return
    window.parent.postMessage({ ns: AGENT_NS, ...msg } satisfies Envelope<FromFrame>, origin)
  }

  const overlay = createOverlay()

  // The component's elements: those inside the container, and those it
  // rendered into a portal (a dialog, a menu, a tooltip), which sit under
  // <body> in the DOM but under the component in React's tree. Not the
  // overlay, which goes inside the page's open modal dialog.
  const inside = (el: Element | null): el is Element =>
    !!el && el !== container && !overlay.owns(el) && (container.contains(el) || renderedWithin(el, container))

  // Its parent among them: the DOM parent, and at the top of a portal the
  // element the portal was rendered from.
  const parentOf = (el: Element): Element | null => {
    const parent = el.parentElement
    if (parent === container || inside(parent)) return parent
    return container.contains(el) ? null : reactParent(el, container)
  }

  // What's under a point, as DevTools sees it: while a tool is on, the
  // overlay has pointer-events: none hide nothing (a disabled button, the
  // page behind an open modal dialog).
  const elementAt = (x: number, y: number) => document.elementsFromPoint(x, y).find(inside) ?? null

  // What a wheel at a point scrolls, along one axis: the nearest box around
  // the point that can still go that way, or the page. The overlay takes the
  // wheel from the page, so it scrolls for it.
  const canScroll = (el: Element, axis: "x" | "y", d: number) => {
    const page = el === (document.scrollingElement ?? document.documentElement)
    const cs = getComputedStyle(el)
    if (!page && !/auto|scroll|overlay/.test(axis === "y" ? cs.overflowY : cs.overflowX)) return false
    const [at, size, view] =
      axis === "y" ? [el.scrollTop, el.scrollHeight, el.clientHeight] : [el.scrollLeft, el.scrollWidth, el.clientWidth]
    return d < 0 ? at > 0 : at + view < size - 0.5
  }
  const scrollAt = (x: number, y: number, dx: number, dy: number) => {
    if (![x, y, dx, dy].every(Number.isFinite)) return
    const page = document.scrollingElement ?? document.documentElement
    const under = document.elementsFromPoint(x, y).find((el) => !overlay.owns(el)) ?? null
    const along = (axis: "x" | "y", d: number) => {
      if (!d) return null
      for (let el: Element | null = under; el; el = el.parentElement) if (canScroll(el, axis, d)) return el
      return page
    }
    const [sx, sy] = [along("x", dx), along("y", dy)]
    // At once: a page's scroll-behavior: smooth would restart its animation
    // at every turn of the wheel, and lose most of each.
    if (sx && sx === sy) return sx.scrollBy({ left: dx, top: dy, behavior: "instant" })
    sx?.scrollBy({ left: dx, behavior: "instant" })
    sy?.scrollBy({ top: dy, behavior: "instant" })
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

  // The nearest element at or around `el` with a location.
  const located = (node: Element) => node.hasAttribute(SOURCE_ATTRIBUTE)
  const nearest = (el: Element) => {
    for (let node: Element | null = el; inside(node); node = parentOf(node)) if (located(node)) return node
    return null
  }
  const locOf = (el: Element) => el.getAttribute(SOURCE_ATTRIBUTE)!
  const inOwnFile = (el: Element) => fileOf(locOf(el)) === ownFile
  // Which of the elements written where `el` is it is, inside `scope` (the
  // whole component without one), in document order.
  const ordinal = (el: Element, scope: Element | null) => {
    const all = withLoc(locOf(el)).filter((m) => !scope || scope.contains(m) || isWithin(m, scope))
    return { index: all.indexOf(el), count: all.length }
  }
  // Inside `scope` as React has it: in its DOM, or in a portal rendered from it.
  const isWithin = (el: Element, scope: Element) => {
    for (let node: Element | null = el; inside(node); node = parentOf(node)) if (node === scope) return true
    return false
  }

  // From where it's written out to the previewed component: the located
  // elements it's inside, the first in each file on the way out, ending at
  // the first in the previewed component's file, where it's used (or the
  // component holding it is). Each with which of the elements written there
  // it is, inside the next one out (the last, in the whole component: a
  // .map()'s rows each holding one). Read off the DOM alone: whether a
  // component passes its props on doesn't matter.
  const pathOf = (anchor: Element): ElementContext["path"] => {
    const steps: Element[] = [anchor]
    for (let node = parentOf(anchor); inside(node) && !inOwnFile(steps.at(-1)!); node = parentOf(node))
      if (located(node) && fileOf(locOf(node)) !== fileOf(locOf(steps.at(-1)!))) steps.push(node)
    if (steps.length === 1 && inOwnFile(anchor)) return []
    return steps.map((step, i) => ({ loc: locOf(step), ...ordinal(step, steps[i + 1] ?? null) }))
  }

  // Written in the previewed component, one of several rendered from there:
  // a .map()'s items. Counted inside the nearest item of a list around it,
  // so a list in a list counts each inner list on its own, and that outer
  // item is said too, out to the outermost list.
  const repeatOf = (anchor: Element): ElementContext["repeat"] => {
    if (!inOwnFile(anchor)) return []
    const isItem = (node: Element) => located(node) && inOwnFile(node) && withLoc(locOf(node)).length > 1
    const levels: ElementContext["repeat"] = []
    let item: Element | null = anchor
    while (item) {
      let scope: Element | null = null
      for (let node = parentOf(item); inside(node); node = parentOf(node))
        if (isItem(node)) {
          scope = node
          break
        }
      const { index, count } = ordinal(item, scope)
      if (count > 1) levels.push({ loc: locOf(item), index, count })
      item = scope
    }
    return levels
  }

  // One with no location of its own (a library rendered it): which of the
  // elements of its kind its parent holds, as the stars of a rating.
  const siblingOf = (el: Element): ElementContext["sibling"] => {
    if (located(el) || !el.parentElement) return null
    const like = [...el.parentElement.children].filter((c) => c.localName === el.localName)
    return like.length > 1 ? { index: like.indexOf(el), count: like.length } : null
  }

  const contextFor = (el: Element): ElementContext => {
    const info = infoFor(el)
    const anchor = nearest(el)
    return {
      viewport: [window.innerWidth, window.innerHeight],
      element: el.localName + (el.id ? `#${el.id}` : "") + [...el.classList].slice(0, 6).map((c) => `.${c}`).join(""),
      html: markupOf(el, overlay.owns),
      text: info.text,
      within: anchor && anchor !== el ? openingTag(anchor) : null,
      path: anchor ? pathOf(anchor) : [],
      repeat: anchor ? repeatOf(anchor) : [],
      sibling: siblingOf(el),
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

  // ── Tracked elements, followed as the selection is ─────────────────────

  // Each element found once and kept while it's still there (React keeps the
  // node), found again by its ref when it isn't. Their boxes are read every
  // frame, so a scroll or a layout shift moves them as an edit does.
  let tracking: ElementRef[] = []
  let tracked: (Element | null)[] = []
  let lastRects = ""
  let trackWatch = 0
  const rectOf = (el: Element | null): Rect | null => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }
  const trackedRects = () => {
    tracked = tracking.map((ref, i) => {
      const el = tracked[i]
      return el?.isConnected && inside(el) ? el : find(ref)
    })
    return tracked.map(rectOf)
  }
  const watchTracked = () => {
    trackWatch = requestAnimationFrame(watchTracked)
    const rects = trackedRects()
    const key = JSON.stringify(rects)
    if (key === lastRects) return
    lastRects = key
    post({ type: "tracked", rects })
  }
  const track = (refs: ElementRef[]) => {
    tracking = refs
    tracked = []
    cancelAnimationFrame(trackWatch)
    trackWatch = refs.length ? requestAnimationFrame(watchTracked) : 0
    const rects = trackedRects()
    lastRects = JSON.stringify(rects)
    return rects
  }

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

  // ── Picking, while a tool is on ───────────────────────────────────────

  // The overlay has the page's pointer. What's under it is found and drawn
  // here, every frame, asking nothing of the shell. A click picks it (Inspect
  // selects it, Comment says where), and the wheel is the shell's: its canvas
  // pans with it, or here the page scrolls with it (a frame's own window,
  // where nothing pans).
  let tool: Tool | null = null
  let wheelMode: WheelMode = "pass"
  let zoom = 1
  let point: { x: number; y: number } | null = null
  // The element an open comment box is on.
  let marked: Element | null = null
  let markedRef: ElementRef | null = null
  let drawing = 0

  const draw = () => {
    drawing = requestAnimationFrame(draw)
    // Found again each frame: a scroll or a re-render changes what's under a
    // still pointer.
    const hovered = point ? elementAt(point.x, point.y) : null
    if (markedRef && !marked?.isConnected) marked = find(markedRef)
    const picked = tool === "inspect" ? selected : marked
    overlay.keepOnTop()
    overlay.draw(hovered === picked ? null : hovered, picked, zoom)
  }

  // The overlay's events, taken at the window before anything of the page's
  // sees them: a menu, popover or dialog that closes on a pointerdown outside
  // it (Radix's, Headless UI's) stays open to be picked from.
  const POINTER = [
    "pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave",
    "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "click", "dblclick", "auxclick",
    "contextmenu", "touchstart", "touchend", "touchmove", "wheel",
  ]
  const onPointer = (e: Event) => {
    if (!e.composedPath().includes(overlay.catcher)) return
    e.stopImmediatePropagation()
    // No focus taken in the page, no text selected, no menu, no page scroll.
    if (e.type !== "pointermove" && e.type !== "mousemove" && e.cancelable) e.preventDefault()
    const m = e as MouseEvent
    switch (e.type) {
      case "pointermove":
        if (!point) post({ type: "hovering" })
        point = { x: m.clientX, y: m.clientY }
        return
      case "pointerleave":
        point = null
        return
      case "click": {
        const el = elementAt(m.clientX, m.clientY)
        if (tool === "inspect") post({ type: "selected", info: select(el) })
        else if (tool === "comment")
          post({ type: "comment-at", x: Math.round(m.clientX), y: Math.round(m.clientY), info: el && infoFor(el) })
        return
      }
      case "wheel": {
        const w = e as WheelEvent
        point = { x: w.clientX, y: w.clientY }
        if (wheelMode === "scroll") {
          // Some mice count lines, or pages.
          const unit = w.deltaMode === 1 ? 16 : w.deltaMode === 2 ? window.innerHeight : 1
          return scrollAt(w.clientX, w.clientY, w.deltaX * unit, w.deltaY * unit)
        }
        const { deltaX, deltaY, deltaMode, ctrlKey, metaKey, shiftKey, altKey } = w
        post({ type: "wheel", x: w.clientX, y: w.clientY, deltaX, deltaY, deltaMode, ctrlKey, metaKey, shiftKey, altKey })
      }
    }
  }

  // Keys pressed while the frame has focus (it took it before the tool was
  // on) are the shell's tools': each goes there, down and up, so what the
  // shell holds as pressed is let go too. Not those with Cmd, Ctrl or Alt,
  // which are the app's menu's and the system's, nor Tab, nor a modifier on
  // its own: the browser keeps those.
  const MODIFIERS = new Set(["Shift", "Meta", "Control", "Alt", "AltGraph", "CapsLock", "Fn", "Tab"])
  const down = new Map<string, KeyboardEvent>()
  const sendKey = (e: KeyboardEvent, kind: "down" | "up") => {
    const { key, code, ctrlKey, metaKey, shiftKey, altKey, repeat } = e
    post({ type: "key", kind, key, code, ctrlKey, metaKey, shiftKey, altKey, repeat })
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey || MODIFIERS.has(e.key)) return
    if (e.type === "keyup" && !down.has(e.code)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.type === "keydown") down.set(e.code, e)
    else down.delete(e.code)
    sendKey(e, e.type === "keydown" ? "down" : "up")
  }
  // Whatever's still held goes up: the shell would hold it forever.
  const letGo = () => {
    for (const e of down.values()) sendKey(e, "up")
    down.clear()
  }

  const setTool = (next: Tool | null, wheel: WheelMode, at: number) => {
    wheelMode = wheel
    zoom = Number.isFinite(at) && at > 0 ? at : 1
    if (next === tool) return
    tool = next
    marked = markedRef = null
    if (!tool) {
      overlay.hide()
      cancelAnimationFrame(drawing)
      drawing = 0
      point = null
      for (const type of POINTER) window.removeEventListener(type, onPointer, true)
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("keyup", onKey, true)
      window.removeEventListener("blur", letGo)
      letGo()
      return
    }
    overlay.show()
    for (const type of POINTER) window.addEventListener(type, onPointer, { capture: true, passive: false })
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("keyup", onKey, true)
    window.addEventListener("blur", letGo)
    if (!drawing) drawing = requestAnimationFrame(draw)
  }

  // The page is going (a reload, Vite's full reload): the shell keeps the
  // pointer off it until the agent is back in the next one.
  const onHide = () => {
    letGo()
    post({ type: "gone" })
  }
  window.addEventListener("pagehide", onHide)

  // ── Messages ───────────────────────────────────────────────────────────

  const ready = (id?: number, origin?: string) =>
    post(
      {
        type: "ready",
        id,
        componentName,
        tagged: !!container.querySelector(`[${SOURCE_ATTRIBUTE}]`),
      },
      origin,
    )

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.data?.ns !== AGENT_NS) return
    canvasOrigin = event.origin
    const msg = event.data as ToFrame
    switch (msg.type) {
      case "hello":
        return ready(msg.id)
      case "tool":
        return setTool(msg.tool, msg.wheel, msg.zoom)
      case "select":
        return post({ type: "selected", id: msg.id, info: select(msg.ref && find(msg.ref)) })
      case "walk":
        return post({ type: "selected", id: msg.id, info: select(walk(msg.dir)) })
      case "leave":
        point = null
        return
      case "mark":
        markedRef = msg.ref
        marked = msg.ref && find(msg.ref)
        return
      case "context":
        return post({
          type: "context",
          id: msg.id,
          contexts: msg.refs.map((ref) => {
            const el = find(ref)
            return el && contextFor(el)
          }),
        })
      case "track":
        return post({ type: "tracked", id: msg.id, rects: track(msg.refs) })
    }
  }
  window.addEventListener("message", onMessage)

  // A shell that loaded before this started learns of it here. Only "ready"
  // goes to any parent: it says no more than the frame's URL does.
  ready(undefined, "*")

  return () => {
    setTool(null, wheelMode, zoom)
    window.removeEventListener("pagehide", onHide)
    window.removeEventListener("message", onMessage)
    window.removeEventListener("resize", schedule)
    mutations.disconnect()
    cancelAnimationFrame(frame)
    cancelAnimationFrame(watching)
    cancelAnimationFrame(trackWatch)
  }
}
