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

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0))
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
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
const frames = () => new Promise((resolve) => setTimeout(resolve, 5))

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
  expect(ask({ type: "resolve", id: 2, refs: [ref, { loc: "gone.tsx:1:1", index: 0, path: [9], tag: "p" }] }).msg).toMatchObject({
    type: "resolved",
    infos: [{ text: "two" }, null],
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
