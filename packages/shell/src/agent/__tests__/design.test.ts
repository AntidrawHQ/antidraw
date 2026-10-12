// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../agent"
import { AGENT_NS, EDIT_ATTRIBUTE, type FromFrame, type ToFrame } from "../protocol"

// The Design panel's side in a frame: an element's styles read off it, and
// edits shown over the page, on whatever element React has there now.

const CANVAS = "https://canvas.test"
const OWN = "src/components/user-components/Card.tsx"

let stop: () => void
let sent: FromFrame[]
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
  sent = []
  vi.spyOn(window, "postMessage").mockImplementation(((msg: FromFrame) => {
    sent.push(msg)
  }) as typeof window.postMessage)
  document.body.innerHTML = `
    <div id="frame">
      <div class="card" data-ad-loc="${OWN}:3:5" style="display: flex; flex-direction: column; padding: 24px 16px; border-top-left-radius: 16px; background-color: rgb(255, 255, 255); opacity: 0.5">
        <h3 data-ad-loc="${OWN}:4:7">Pro</h3>
        <button data-ad-loc="${OWN}:5:7"><svg></svg> Buy now </button>
        <p data-ad-loc="${OWN}:6:7">$24<span>/mo</span> billed yearly</p>
        <ul data-ad-loc="${OWN}:7:7" style="display: grid; column-gap: 12px; row-gap: 12px; margin-top: 8px; margin-bottom: 16px; background-image: linear-gradient(red, blue); box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px"></ul>
      </div>
    </div>`
  stop = startInspector(document.getElementById("frame")!, "Card")
})

afterEach(() => {
  stop()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const ask = (msg: ToFrame) => {
  window.dispatchEvent(new MessageEvent("message", { data: { ns: AGENT_NS, ...msg }, origin: CANVAS, source: window }))
  return sent.at(-1)!
}
// The page's mutations, then the frame they're looked at in.
const frames = async () => {
  await Promise.resolve()
  for (const [id, fn] of [...queued]) {
    queued.delete(id)
    fn(0)
  }
}
const card = () => document.querySelector(".card")!
const ref = { loc: `${OWN}:3:5`, index: 0, path: [0], tag: "div" }

test("reads an element's styles as the panel edits them", () => {
  const reply = ask({ type: "style", id: 1, ref })
  expect(reply).toMatchObject({
    type: "style",
    id: 1,
    text: false,
    style: { flow: "column", pt: 24, pr: 16, pb: 24, pl: 16, radius: 16, fill: "#FFFFFF", fillA: 100, opacity: 50 },
  })
  expect(ask({ type: "style", id: 2, ref: { ...ref, loc: `${OWN}:9:9`, path: [7] } })).toMatchObject({ type: "style", id: 2, style: null, text: false })
  // Text written right in it.
  expect(ask({ type: "style", id: 3, ref: { loc: `${OWN}:4:7`, index: 0, path: [0, 0], tag: "h3" } })).toMatchObject({ text: true })
})

const at = (line: number, tag: string, i: number) => ({ loc: `${OWN}:${line}:7`, index: 0, path: [0, i], tag })

test("reads what the panel shows: its one run of text, margins, a grid, a gradient, stacked shadows", () => {
  const button = ask({ type: "style", id: 1, ref: at(5, "button", 1) }) as Extract<FromFrame, { type: "style" }>
  expect([button.text, button.style?.content]).toEqual([true, "Buy now"])
  // Two runs of text around a <span>: not one the panel can rewrite.
  expect((ask({ type: "style", id: 2, ref: at(6, "p", 2) }) as Extract<FromFrame, { type: "style" }>).style?.content).toBeNull()
  const list = (ask({ type: "style", id: 3, ref: at(7, "ul", 3) }) as Extract<FromFrame, { type: "style" }>).style!
  expect(list).toMatchObject({ flow: "grid", gap: 12, mt: 8, mb: 16, gradient: true })
  // The first that shows is edited; the other is kept; the empty one goes.
  expect([list.shadow, list.shadowRest]).toEqual([
    { x: 0, y: 1, blur: 3, spread: 0, color: "#000000", a: 10 },
    ["rgba(0, 0, 0, 0.1) 0px 1px 2px -1px"],
  ])
})

test("writes an edit's text into the element, and puts its own back", async () => {
  const button = document.querySelector("button")!
  ask({ type: "preview", id: 1, items: [{ key: "e1", ref: at(5, "button", 1), css: {}, text: "Start $& trial" }] })
  // Its spaces and its icon as they were.
  expect(button.textContent).toBe(" Start $& trial ")
  expect(button.querySelector("svg")).not.toBeNull()
  ask({ type: "preview", id: 2, items: [] })
  expect(button.textContent).toBe(" Buy now ")
})

test("shows edits from a sheet of its own, on the element React has there now", async () => {
  expect(ask({ type: "preview", id: 1, items: [{ key: "e1", ref, css: { "border-radius": "24px" } }] })).toMatchObject({ type: "previewed", missing: [] })
  expect(card().getAttribute(EDIT_ATTRIBUTE)).toBe("e1")
  const sheet = document.head.querySelector("style[data-antidraw-agent]")!
  expect(sheet.textContent).toContain('[data-ad-edit~="e1"][data-ad-edit~="e1"][data-ad-edit~="e1"] { border-radius: 24px !important; }')

  // A re-render replaces the node: the new one gets the edit.
  const fresh = card().cloneNode(true) as Element
  fresh.removeAttribute(EDIT_ATTRIBUTE)
  card().replaceWith(fresh)
  await frames()
  expect(fresh.getAttribute(EDIT_ATTRIBUTE)).toBe("e1")

  // Gone from the page, it's said; back, it's shown again, and said.
  fresh.remove()
  await frames()
  expect(sent.at(-1)).toMatchObject({ type: "previewed", missing: ["e1"] })
  document.getElementById("frame")!.append(fresh)
  await frames()
  expect(sent.at(-1)).toMatchObject({ type: "previewed", missing: [] })

  // None: the sheet and the attribute go.
  ask({ type: "preview", id: 2, items: [] })
  expect(fresh.hasAttribute(EDIT_ATTRIBUTE)).toBe(false)
  expect(sheet.isConnected).toBe(false)
})

test("the attribute stays out of the markup an agent is given", () => {
  ask({ type: "preview", id: 1, items: [{ key: "e1", ref, css: { opacity: "1" } }] })
  const reply = ask({ type: "context", id: 2, refs: [ref] }) as Extract<FromFrame, { type: "context" }>
  expect(reply.contexts[0]!.html).not.toContain(EDIT_ATTRIBUTE)
})
