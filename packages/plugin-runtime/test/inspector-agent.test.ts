// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../src/inspector/agent"
import { INSPECTOR_NS, type FromFrame, type ToFrame } from "../src/inspector/protocol"

// The inspector in a preview frame, driven by messages as the canvas sends
// them. jsdom has no layout, so the element "at" a point is set by the test.

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
  document.elementsFromPoint = () => (at ? [at, container, document.body, document.documentElement] : [])
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
  window.dispatchEvent(new MessageEvent("message", { data: { ns: INSPECTOR_NS, ...msg }, origin: CANVAS, source }))
  return sent.at(-1)!
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
    { msg: { ns: INSPECTOR_NS, type: "ready", protocol: 1, componentName: "Card", tagged: true }, origin: "*" },
  ])
  expect(ask({ type: "hello", id: 7 })).toMatchObject({ msg: { type: "ready", id: 7 }, origin: CANVAS })
})

test("names the element at a point by its source location, and where the component used it", () => {
  at = $(".btn")
  const { msg, origin } = ask({ type: "hit", id: 1, x: 10, y: 10 })
  expect(origin).toBe(CANVAS)
  expect(msg).toMatchObject({
    type: "hover",
    id: 1,
    info: {
      ref: { loc: `${BUTTON}:8:10`, index: 0, path: [0, 1], tag: "button" },
      callsite: `${OWN}:3:5`,
      tag: "button",
      classes: ["btn"],
      text: "Upgrade",
    },
  })
  at = $("h3")
  expect(ask({ type: "hit", id: 2, x: 1, y: 1 }).msg).toMatchObject({ info: { callsite: `${OWN}:4:7`, text: "Pro plan" } })
})

test("tells repeated elements apart by index, and finds them again from a ref", () => {
  at = container.querySelectorAll("li")[1]!
  const { msg } = ask({ type: "select-at", id: 1, x: 0, y: 0 })
  expect(msg).toMatchObject({ type: "selected", info: { ref: { loc: `${OWN}:6:28`, index: 1 }, text: "two" } })
  const ref = (msg as Extract<FromFrame, { type: "selected" }>).info!.ref
  expect(ask({ type: "context", id: 2, refs: [ref, { loc: "gone.tsx:1:1", index: 0, path: [9], tag: "p" }] }).msg).toMatchObject({
    type: "context",
    contexts: [{ text: "two", repeat: { index: 1, count: 2, keys: [] } }, null],
  })
})

const contextOf = (el: Element) => {
  at = el
  const { msg } = ask({ type: "select-at", id: 1, x: 0, y: 0 })
  const ref = (msg as Extract<FromFrame, { type: "selected" }>).info!.ref
  return (ask({ type: "context", id: 2, refs: [ref] }).msg as Extract<FromFrame, { type: "context" }>).contexts[0]
}

test("tells an agent where an element is written, what it is and how it's used", () => {
  $(".btn").setAttribute("data-slot", "button")
  $(".btn").setAttribute("aria-expanded", "false")
  $(".btn").setAttribute("style", "padding: 4px 8px")
  expect(contextOf($(".btn"))).toMatchInlineSnapshot(`
    {
      "attributes": {
        "aria-expanded": "false",
        "data-slot": "button",
      },
      "border": [
        0,
        0,
        0,
        0,
      ],
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:3:5",
          "name": "Card",
        },
        {
          "loc": "src/components/ui/button.tsx:8:10",
          "name": "button",
        },
      ],
      "element": "button.btn",
      "loc": "src/components/ui/button.tsx:8:10",
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
      "text": "Upgrade",
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
    loc: null,
    within: { loc: `${BUTTON}:8:10`, path: "span > svg:nth-of-type(2) > path" },
    components: [{ name: "Card" }, { name: "button", loc: `${BUTTON}:8:10` }],
  })
})

test("only counts elements inside the component, and ignores other windows", () => {
  at = document.body
  expect(ask({ type: "hit", id: 1, x: 0, y: 0 }).msg).toMatchObject({ info: null })
  const before = sent.length
  ask({ type: "hit", id: 2, x: 0, y: 0 }, null)
  expect(sent.length).toBe(before)
})

test("follows the selection when a re-render moves it to another line", async () => {
  at = $("h3")
  ask({ type: "select-at", id: 1, x: 0, y: 0 })
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
  at = $("h3")
  ask({ type: "select-at", id: 1, x: 0, y: 0 })
  // A web font swaps in and the heading shifts down.
  vi.spyOn($("h3"), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 12, 120, 30))
  await frames()
  expect(sent.at(-1)!.msg).toMatchObject({ type: "selection-changed", info: { rect: { x: 0, y: 12, width: 120, height: 30 } } })
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
  at = $("p:nth-of-type(2)")
  const { info } = ask({ type: "select-at", id: 1, x: 0, y: 0 }).msg as Extract<FromFrame, { type: "selected" }>
  // A hook added above the JSX: Fast Refresh remounts, a line lower. "b"'s
  // old location now names "a".
  paragraphs(12, ["a", "b", "c"])
  await frames()
  expect(lastSelection()).toMatchInlineSnapshot(`"selection-changed: "b" at src/components/user-components/Card.tsx:13:5"`)
  // And a tag refreshed on send, with the ref from before.
  const reply = ask({ type: "context", id: 2, refs: [info!.ref] }).msg as Extract<FromFrame, { type: "context" }>
  expect(`${reply.contexts[0]?.text} at ${reply.contexts[0]?.loc}`).toMatchInlineSnapshot(`"b at src/components/user-components/Card.tsx:13:5"`)
})

test("keeps a remounted element by its location when a sibling before it is hidden", async () => {
  paragraphs(11, ["a", "b", "c"])
  at = $("p:nth-of-type(2)")
  ask({ type: "select-at", id: 1, x: 0, y: 0 })
  // State hides "a" and remounts the rest: "b" keeps its line, not its place.
  paragraphs(11, ["a", "b", "c"]).firstElementChild!.remove()
  await frames()
  expect(lastSelection()).toMatchInlineSnapshot(`"selection-changed: "b" at src/components/user-components/Card.tsx:12:5"`)
})

test("says so when the selected element is gone, rather than take its neighbour", async () => {
  at = $("h3")
  ask({ type: "select-at", id: 1, x: 0, y: 0 })
  // Deleting the heading's line moves the button up into its place and its
  // location: another kind of element all the same.
  $(".btn").setAttribute("data-ad-loc", `${OWN}:4:7`)
  $("h3").remove()
  await frames()
  expect(sent.at(-1)!.msg).toEqual({ ns: INSPECTOR_NS, type: "selection-lost" })

  at = $(".card")
  ask({ type: "select-at", id: 1, x: 0, y: 0 })
  $(".card").remove()
  await frames()
  expect(sent.at(-1)!.msg).toEqual({ ns: INSPECTOR_NS, type: "selection-lost" })
})

test("walks the selection through the tree, staying inside the component", () => {
  at = $("h3")
  ask({ type: "select-at", id: 1, x: 0, y: 0 })
  expect(ask({ type: "walk", id: 2, dir: "next" }).msg).toMatchObject({ info: { tag: "button" } })
  expect(ask({ type: "walk", id: 3, dir: "parent" }).msg).toMatchObject({ info: { classes: ["card"] } })
  expect(ask({ type: "walk", id: 4, dir: "parent" }).msg).toMatchObject({ info: { classes: ["card"] } })
  expect(ask({ type: "walk", id: 5, dir: "child" }).msg).toMatchObject({ info: { tag: "h3" } })
  expect(ask({ type: "select", id: 6, ref: null }).msg).toMatchObject({ info: null })
})
