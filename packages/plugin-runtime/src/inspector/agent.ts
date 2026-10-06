import {
  INSPECTOR_NS,
  INSPECTOR_PROTOCOL,
  SOURCE_ATTRIBUTE,
  type ElementInfo,
  type ElementRef,
  type Envelope,
  type FromFrame,
  type Sides,
  type ToFrame,
  type WalkDirection,
} from "./protocol"

// The inspector's half that runs in a preview frame: it finds, measures and
// keeps track of elements for the canvas, which draws and owns the input.
// See protocol.ts. Only elements inside `container` (the component) count.

const USER_COMPONENTS_DIR = "src/components/user-components/"
const LOC_RE = /:\d+:\d+$/

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

  const refFor = (el: Element): ElementRef => {
    const loc = el.getAttribute(SOURCE_ATTRIBUTE)
    const path: number[] = []
    for (let node: Element = el; node !== container && node.parentElement; node = node.parentElement)
      path.unshift([...node.parentElement.children].indexOf(node))
    return { loc, index: loc ? [...withLoc(loc)].indexOf(el) : 0, path, tag: el.localName }
  }

  // The element a ref names now: by source location, then by path. Either
  // way it must be the same kind of element: deleting a line moves the next
  // element up into the deleted one's location.
  const find = (ref: ElementRef): Element | null => {
    const same = (el: Element | null | undefined): el is Element => inside(el ?? null) && el!.localName === ref.tag
    if (ref.loc) {
      const matches = withLoc(ref.loc)
      const hit = matches[ref.index] ?? (matches.length === 1 ? matches[0] : undefined)
      if (same(hit)) return hit
    }
    let node: Element | undefined = container
    for (const i of ref.path) node = node?.children[i]
    return same(node) ? node : null
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
    return {
      ref: refFor(el),
      callsite: callsiteOf(el),
      tag: el.localName,
      id: el.id,
      classes: [...el.classList].slice(0, 4),
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      margin: sides(cs, (s) => `margin-${s}`),
      border: sides(cs, (s) => `border-${s}-width`),
      padding: sides(cs, (s) => `padding-${s}`),
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
      case "resolve":
        return post({
          type: "resolved",
          id: msg.id,
          infos: msg.refs.map((ref) => {
            const el = find(ref)
            return el && infoFor(el)
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
