// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../agent"
import { AGENT_NS, type FromFrame, type ToFrame, type Tool, type WheelMode } from "../protocol"

// The agent in a preview frame, driven by messages as the shell sends them
// and by the pointer on its overlay. jsdom has no layout, so the element
// "at" a point is set by the test.

const CANVAS = "https://canvas.test"
const OWN = "src/components/user-components/Card.tsx"
const BUTTON = "src/components/ui/button.tsx"

let stop: () => void
let sent: { msg: FromFrame; origin: string }[]
let at: Element | null
let container: HTMLElement

// Animation frames run when the test says, not on a timer: a timer can fire
// after the test has stopped waiting for it.
let queued: Map<number, FrameRequestCallback>
let lastFrameId: number

beforeEach(() => {
  queued = new Map()
  lastFrameId = 0
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    queued.set(++lastFrameId, fn)
    return lastFrameId
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queued.delete(id))
  at = null
  // The overlay first, while it's up, as a browser has it.
  document.elementsFromPoint = () => [
    ...(host() ? [host()!] : []),
    ...(at ? [at, container, document.body, document.documentElement] : []),
  ]
  sent = []
  vi.spyOn(window, "postMessage").mockImplementation(((msg: FromFrame, origin: string) => {
    sent.push({ msg, origin })
  }) as typeof window.postMessage)

  document.body.innerHTML = `
    <div id="root"><div id="frame">
      <div class="card" data-ad-loc="${OWN}:3:5">
        <h3 data-ad-loc="${OWN}:4:7">Pro   plan</h3>
        <button class="btn" data-ad-loc="${BUTTON}:8:10">Upgrade</button>
        <li data-ad-loc="${OWN}:6:28">one</li>
        <li data-ad-loc="${OWN}:6:28">two</li>
      </div>
    </div></div>`
  container = document.getElementById("frame")!
  stop = startInspector(container, "Card")
})

afterEach(() => {
  stop()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const ask = (msg: ToFrame, source: MessageEventSource | null = window) => {
  window.dispatchEvent(new MessageEvent("message", { data: { ns: AGENT_NS, ...msg }, origin: CANVAS, source }))
  return sent.at(-1)!
}
const host = () => document.querySelector("antidraw-agent")
const shadow = () => host()!.shadowRoot!
const catcher = () => shadow().querySelector(".catcher")!
const tool = (on: Tool | null, wheel: WheelMode = "pass", zoom = 1) => ask({ type: "tool", id: 0, tool: on, wheel, zoom })
// A click on what's at the point, with the tool on.
const click = (el: Element | null) => {
  at = el
  catcher().dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, clientX: 10.4, clientY: 20.6 }))
  return sent.at(-1)!
}
type Selected = Extract<FromFrame, { type: "selected" }>
// Selected with Inspect.
const pick = (el: Element) => {
  tool("inspect")
  return click(el).msg as Selected
}
const $ = (selector: string) => container.querySelector(selector)!
// A few frames, each after the DOM's pending mutation records are delivered.
const frames = async (count = 3) => {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const due = [...queued.values()]
    queued.clear()
    for (const fn of due) fn(0)
  }
}

test("says it's ready to any parent, and whether the dev server tagged it", () => {
  expect(sent).toEqual([
    { msg: { ns: AGENT_NS, type: "ready", componentName: "Card", tagged: true }, origin: "*" },
  ])
  expect(ask({ type: "hello", id: 7 })).toMatchObject({ msg: { type: "ready", id: 7 }, origin: CANVAS })
})

test("names the element clicked by its source location, and where the component used it", () => {
  tool("inspect")
  const { msg, origin } = click($(".btn"))
  expect(origin).toBe(CANVAS)
  expect(msg).toMatchObject({
    type: "selected",
    info: {
      ref: { loc: `${BUTTON}:8:10`, index: 0, path: [0, 1], tag: "button" },
      callsite: `${OWN}:3:5`,
      tag: "button",
      classes: ["btn"],
      text: "Upgrade",
    },
  })
  expect(click($("h3")).msg).toMatchObject({ info: { callsite: `${OWN}:4:7`, text: "Pro plan" } })
})

test("tells repeated elements apart by index, and finds them again from a ref", () => {
  const msg = pick(container.querySelectorAll("li")[1]!)
  expect(msg).toMatchObject({ type: "selected", info: { ref: { loc: `${OWN}:6:28`, index: 1 }, text: "two" } })
  const ref = msg.info!.ref
  expect(ask({ type: "context", id: 2, refs: [ref, { loc: "gone.tsx:1:1", index: 0, path: [9], tag: "p" }] }).msg).toMatchObject({
    type: "context",
    contexts: [{ html: `<li data-ad-loc="${OWN}:6:28">two</li>`, repeat: { index: 1, count: 2 } }, null],
  })
})

const contextOf = (el: Element) => {
  const ref = pick(el).info!.ref
  return (ask({ type: "context", id: 2, refs: [ref] }).msg as Extract<FromFrame, { type: "context" }>).contexts[0]
}

test("tells an agent what an element is, with where it's written, as its markup", () => {
  $(".btn").setAttribute("data-slot", "button")
  $(".btn").setAttribute("aria-expanded", "false")
  $(".btn").setAttribute("style", "padding: 4px 8px")
  expect(contextOf($(".btn"))).toMatchInlineSnapshot(`
    {
      "border": [
        0,
        0,
        0,
        0,
      ],
      "element": "button.btn",
      "html": "<button class="btn" data-ad-loc="src/components/ui/button.tsx:8:10" data-slot="button" aria-expanded="false" style="padding: 4px 8px">Upgrade</button>",
      "margin": [
        0,
        0,
        0,
        0,
      ],
      "padding": [
        4,
        8,
        4,
        8,
      ],
      "repeat": null,
      "size": [
        0,
        0,
      ],
      "viewport": [
        1024,
        768,
      ],
      "within": null,
    }
  `)
})

test("places an element without a location of its own inside the nearest one that has one", () => {
  $(".btn").innerHTML = `<span><svg></svg><svg><path></path></svg></span>`
  expect(contextOf($(".btn path"))).toMatchObject({
    html: "<path></path>",
    within: `<button class="btn" data-ad-loc="${BUTTON}:8:10">`,
  })
  // One with a location of its own needs none.
  expect(contextOf($(".btn"))).toMatchObject({ within: null })
})

test("only counts elements inside the component, and ignores other windows", () => {
  expect(pick(document.body)).toMatchObject({ info: null })
  const before = sent.length
  ask({ type: "hello", id: 2 }, null)
  expect(sent.length).toBe(before)
})

test("follows the selection when a re-render moves it to another line", async () => {
  pick($("h3"))
  // Fast Refresh keeps the node and updates its attribute.
  $("h3").setAttribute("data-ad-loc", `${OWN}:6:7`)
  await frames()
  expect(sent.at(-1)!.msg).toMatchObject({ type: "selection-changed", info: { ref: { loc: `${OWN}:6:7` } } })
  // A remount replaces it: found again at the same place.
  const fresh = document.createElement("h3")
  fresh.setAttribute("data-ad-loc", `${OWN}:7:7`)
  fresh.textContent = "Team plan"
  $("h3").replaceWith(fresh)
  await frames()
  expect(sent.at(-1)!.msg).toMatchObject({ type: "selection-changed", info: { ref: { loc: `${OWN}:7:7` }, text: "Team plan" } })
})

test("follows the selection when it moves without the DOM changing", async () => {
  pick($("h3"))
  // A web font swaps in and the heading shifts down.
  vi.spyOn($("h3"), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 12, 120, 30))
  await frames()
  expect(sent.at(-1)!.msg).toMatchObject({ type: "selection-changed", info: { rect: { x: 0, y: 12, width: 120, height: 30 } } })
})

test("tracks elements' boxes as they move, scroll, remount and go, until told to stop", async () => {
  const refs = (["h3", ".btn"] as const).map((s) => pick($(s)).info!.ref)
  // Not the selection's: that says when it moves on its own.
  ask({ type: "select", id: 1, ref: null })
  const box = (el: Element, x: number, y: number) => vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, 120, 30))
  box($("h3"), 0, 10)
  box($(".btn"), 0, 50)
  const missing = { loc: `${OWN}:99:1`, index: 0, path: [9], tag: "p" }
  expect(ask({ type: "track", id: 2, refs: [...refs, missing] }).msg).toMatchObject({
    type: "tracked",
    id: 2,
    rects: [{ x: 0, y: 10 }, { x: 0, y: 50 }, null],
  })
  // Nothing moved: nothing said.
  const said = sent.length
  await frames()
  expect(sent.length).toBe(said)
  // The page scrolls by 40.
  box($("h3"), 0, -30)
  box($(".btn"), 0, 10)
  await frames()
  expect(sent.at(-1)!.msg).toEqual({
    ns: AGENT_NS,
    type: "tracked",
    rects: [
      { x: 0, y: -30, width: 120, height: 30 },
      { x: 0, y: 10, width: 120, height: 30 },
      null,
    ],
  })
  // The heading remounts; the button goes.
  const fresh = document.createElement("h3")
  fresh.setAttribute("data-ad-loc", `${OWN}:4:7`)
  box(fresh, 0, 99)
  $("h3").replaceWith(fresh)
  $(".btn").remove()
  await frames()
  expect(sent.at(-1)!.msg).toMatchObject({ type: "tracked", rects: [{ y: 99 }, null, null] })
  // Stopped: no more.
  expect(ask({ type: "track", id: 3, refs: [] }).msg).toMatchObject({ type: "tracked", id: 3, rects: [] })
  box(fresh, 0, 5)
  const stopped = sent.length
  await frames()
  expect(sent.length).toBe(stopped)
})

test("scrolls what a wheel over it would: the nearest box that can go that way, or the page", () => {
  const scrolled: string[] = []
  const scrollable = (el: Element, { top = 0, height = 100, view = 50, overflow = "auto" } = {}) => {
    ;(el as HTMLElement).style.overflowY = overflow
    Object.defineProperties(el, {
      scrollTop: { configurable: true, value: top },
      scrollHeight: { configurable: true, value: height },
      clientHeight: { configurable: true, value: view },
    })
    el.scrollBy = ((o: ScrollToOptions) => void scrolled.push(`${el.localName}.${el.className || el.id} ${o.top}`)) as Element["scrollBy"]
  }
  const page = document.scrollingElement ?? document.documentElement
  scrollable(page, { overflow: "" })
  scrollable($(".card"))
  // In a frame's own window, with a tool on.
  tool("inspect", "scroll")
  const wheel = (deltaY: number, deltaMode = 0) =>
    catcher().dispatchEvent(new WheelEvent("wheel", { bubbles: true, composed: true, cancelable: true, deltaY, deltaMode }))
  at = $("h3")
  wheel(30)
  // At its top, the card can't go up: the page does.
  wheel(-30)
  // Nothing under the point: the page. A mouse that counts lines.
  at = null
  wheel(2, 1)
  expect(scrolled).toEqual(["div.card 30", "html. -30", "html. 32"])
  // And nothing goes to the shell.
  expect(sent.at(-1)!.msg.type).not.toBe("wheel")
})

// Paragraphs written one per line, from line `first`, as a remount renders them.
const paragraphs = (first: number, texts: string[]) => {
  const list = document.createElement("div")
  list.setAttribute("data-ad-loc", `${OWN}:${first - 1}:3`)
  list.innerHTML = texts.map((t, i) => `<p data-ad-loc="${OWN}:${first + i}:5">${t}</p>`).join("")
  container.replaceChildren(list)
  return list
}
const lastSelection = () => {
  const msg = sent.at(-1)!.msg as Extract<FromFrame, { type: "selection-changed" }>
  return `${msg.type}: ${JSON.stringify(msg.info?.text)} at ${msg.info?.ref.loc}`
}

test("finds a remounted element again when a line added above moves every location", async () => {
  paragraphs(11, ["a", "b", "c"])
  const { info } = pick($("p:nth-of-type(2)"))
  // A hook added above the JSX: Fast Refresh remounts, a line lower. "b"'s
  // old location now names "a".
  paragraphs(12, ["a", "b", "c"])
  await frames()
  expect(lastSelection()).toMatchInlineSnapshot(`"selection-changed: "b" at src/components/user-components/Card.tsx:13:5"`)
  // And a tag refreshed on send, with the ref from before.
  const reply = ask({ type: "context", id: 2, refs: [info!.ref] }).msg as Extract<FromFrame, { type: "context" }>
  expect(reply.contexts[0]?.html).toMatchInlineSnapshot(`"<p data-ad-loc="src/components/user-components/Card.tsx:13:5">b</p>"`)
})

test("keeps a remounted element by its location when a sibling before it is hidden", async () => {
  paragraphs(11, ["a", "b", "c"])
  pick($("p:nth-of-type(2)"))
  // State hides "a" and remounts the rest: "b" keeps its line, not its place.
  paragraphs(11, ["a", "b", "c"]).firstElementChild!.remove()
  await frames()
  expect(lastSelection()).toMatchInlineSnapshot(`"selection-changed: "b" at src/components/user-components/Card.tsx:12:5"`)
})

test("says so when the selected element is gone, rather than take its neighbour", async () => {
  pick($("h3"))
  // Deleting the heading's line moves the button up into its place and its
  // location: another kind of element all the same.
  $(".btn").setAttribute("data-ad-loc", `${OWN}:4:7`)
  $("h3").remove()
  await frames()
  expect(sent.at(-1)!.msg).toEqual({ ns: AGENT_NS, type: "selection-lost" })

  pick($(".card"))
  $(".card").remove()
  await frames()
  expect(sent.at(-1)!.msg).toEqual({ ns: AGENT_NS, type: "selection-lost" })
})

test("walks the selection through the tree, staying inside the component", () => {
  pick($("h3"))
  expect(ask({ type: "walk", id: 2, dir: "next" }).msg).toMatchObject({ info: { tag: "button" } })
  expect(ask({ type: "walk", id: 3, dir: "parent" }).msg).toMatchObject({ info: { classes: ["card"] } })
  expect(ask({ type: "walk", id: 4, dir: "parent" }).msg).toMatchObject({ info: { classes: ["card"] } })
  expect(ask({ type: "walk", id: 5, dir: "child" }).msg).toMatchObject({ info: { tag: "h3" } })
  expect(ask({ type: "select", id: 6, ref: null }).msg).toMatchObject({ info: null })
})

// ── The tools ────────────────────────────────────────────────────────────

const shown = () => [...shadow().querySelectorAll<HTMLElement>(".box")].filter((b) => !b.hidden)

test("takes the pointer from the page only while a tool is on", () => {
  expect(host()).toBeNull()
  tool("inspect")
  expect(host()!.isConnected).toBe(true)
  // Hit-testing sees what pointer-events: none would hide.
  expect(document.head.innerHTML).toContain("pointer-events: auto !important")
  tool(null)
  expect(host()).toBeNull()
  expect(document.head.innerHTML).not.toContain("pointer-events")
})

test("draws the element under the pointer, and the one picked, every frame", async () => {
  vi.spyOn($("h3"), "getBoundingClientRect").mockReturnValue(new DOMRect(4, 8, 120, 30))
  vi.spyOn($(".btn"), "getBoundingClientRect").mockReturnValue(new DOMRect(4, 50, 80, 24))
  tool("inspect", "pass", 0.5)
  at = $("h3")
  catcher().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, clientX: 5, clientY: 9 }))
  await frames(1)
  // The box model: margin, border, padding and content.
  expect(shown()).toHaveLength(4)
  expect(shown()[1]!.style.transform).toBe("translate(4px, 8px)")
  // The page moves under a still pointer: what's under it now.
  at = $(".btn")
  await frames(1)
  expect(shown()[1]!.style.transform).toBe("translate(4px, 50px)")
  // Picked: outlined, two screen pixels at the canvas's zoom, and not drawn twice.
  click($(".btn"))
  await frames(1)
  expect(shown()).toHaveLength(1)
  expect(shown()[0]!.style.outline).toBe("4px solid #3b82f6")
  catcher().dispatchEvent(new PointerEvent("pointerleave", { composed: true }))
  at = null
  await frames(1)
  expect(shown()).toHaveLength(1)
})

test("a click with the Comment tool says where and on what, and outlines what the shell marks", async () => {
  tool("comment")
  expect(click($(".btn")).msg).toMatchObject({ type: "comment-at", x: 10, y: 21, info: { tag: "button", ref: { loc: `${BUTTON}:8:10` } } })
  expect(click(null).msg).toMatchObject({ type: "comment-at", info: null })
  const ref = pick($(".btn")).info!.ref
  tool("comment")
  vi.spyOn($(".btn"), "getBoundingClientRect").mockReturnValue(new DOMRect(4, 50, 80, 24))
  ask({ type: "mark", id: 1, ref })
  await frames(1)
  expect(shown().map((b) => b.style.transform)).toEqual(["translate(4px, 50px)"])
  ask({ type: "mark", id: 2, ref: null })
  await frames(1)
  expect(shown()).toEqual([])
})

test("passes the wheel to the shell, whose canvas pans with it", () => {
  tool("comment")
  const wheel = new WheelEvent("wheel", { bubbles: true, composed: true, cancelable: true, clientX: 3, clientY: 4, deltaY: 12, ctrlKey: true })
  catcher().dispatchEvent(wheel)
  expect(wheel.defaultPrevented).toBe(true)
  expect(sent.at(-1)!.msg).toEqual({
    ns: AGENT_NS,
    type: "wheel",
    x: 3,
    y: 4,
    deltaX: 0,
    deltaY: 12,
    deltaMode: 0,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  })
})

test("passes the tools' keys to the shell, down and up, and leaves the browser's alone", () => {
  const page = vi.fn()
  window.addEventListener("keydown", page)
  tool("inspect")
  const press = (type: "keydown" | "keyup", key: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true, ...init })
    document.body.dispatchEvent(e)
    return e.defaultPrevented
  }
  const keys = () => sent.filter((s) => s.msg.type === "key").map((s) => {
    const k = s.msg as Extract<FromFrame, { type: "key" }>
    return `${k.kind} ${k.key}`
  })
  expect(press("keydown", "ArrowUp")).toBe(true)
  expect(press("keyup", "ArrowUp")).toBe(true)
  expect(page).not.toHaveBeenCalled()
  // The app's menu's, the system's, and a modifier alone: the browser's.
  expect(press("keydown", "w", { metaKey: true })).toBe(false)
  expect(press("keydown", "Shift")).toBe(false)
  expect(press("keydown", "Tab")).toBe(false)
  // Held when the tool goes off: let go there too.
  press("keydown", " ")
  tool(null)
  expect(keys()).toEqual(["down ArrowUp", "up ArrowUp", "down  ", "up  "])
  const said = sent.length
  expect(press("keydown", "i")).toBe(false)
  expect(sent.length).toBe(said)
  window.removeEventListener("keydown", page)
})

test("keeps the tool's clicks from the page: a menu that closes on a click outside it stays open", () => {
  const outside = vi.fn()
  document.addEventListener("pointerdown", outside)
  document.addEventListener("click", outside, true)
  tool("comment")
  at = $(".btn")
  catcher().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, cancelable: true }))
  click($(".btn"))
  expect(outside).not.toHaveBeenCalled()
  expect(sent.at(-1)!.msg.type).toBe("comment-at")
  document.removeEventListener("pointerdown", outside)
  document.removeEventListener("click", outside, true)
})

test("says so when the page goes, and lets go of any key held", () => {
  tool("inspect")
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }))
  window.dispatchEvent(new Event("pagehide"))
  expect(sent.slice(-2).map((s) => s.msg)).toMatchObject([{ type: "key", kind: "up", key: "ArrowDown" }, { type: "gone" }])
})

test("never picks its own overlay, when it's inside the component (a modal dialog of the page's)", () => {
  tool("comment")
  // Where the overlay goes while the page has a modal dialog open.
  $(".card").append(host()!)
  expect(click($(".btn")).msg).toMatchObject({ type: "comment-at", info: { tag: "button" } })
  expect(ask({ type: "walk", id: 1, dir: "next" })).toBeTruthy()
})
