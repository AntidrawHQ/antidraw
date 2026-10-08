// @vitest-environment jsdom
import { act, createElement as h, forwardRef, lazy, memo, Suspense, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../src/inspector/agent"
import { INSPECTOR_NS, type ElementContext, type FromFrame } from "../src/inspector/protocol"

// What an agent is told about elements of a real React tree: where each is
// written, which components rendered it, and which item of a list it is.
// The stamps are written by hand here, as the dev server's tagger would.

const CARD = "src/components/user-components/Card.tsx"
const BUTTON = "src/components/ui/button.tsx"
const BOX = "src/components/ui/box.tsx"
const MENU = "src/components/ui/dropdown-menu.tsx"
const loc = (file: string, line: number) => ({ "data-ad-loc": `${file}:${line}:5` })

// A library icon: nothing the dev server stamped.
const Icon = () => h("svg", null, h("path"))
const Button = ({ children }: { children: ReactNode }) =>
  h("button", { ...loc(BUTTON, 3), className: "btn", "data-slot": "button" }, h(Icon), children)
// Holds what it's given; it didn't render it.
const Box = ({ children }: { children: ReactNode }) => h("div", { ...loc(BOX, 2), className: "box" }, children)
const Trigger = forwardRef<HTMLButtonElement, { children: ReactNode }>(function Trigger({ children }, ref) {
  return h(
    "button",
    { ...loc(MENU, 7), ref, "data-slot": "dropdown-menu-trigger", "data-state": "open", "aria-expanded": "true" },
    children,
  )
})
// esbuild renames the function to Row2 (its name shadows the variable's), as
// the dev server does.
const Row = memo(function Row({ plan, features }: { plan: string; features: string[] }) {
  return h(
    "li",
    loc(CARD, 9),
    h("h4", loc(CARD, 10), plan),
    h("ul", loc(CARD, 11), features.map((f) => h("li", { ...loc(CARD, 12), key: f }, f))),
    h(Button, null, "Choose"),
  )
})
function Card() {
  return h(
    "div",
    { ...loc(CARD, 3), className: "card" },
    h(
      "h3",
      { ...loc(CARD, 4), id: "title", className: "text-lg font-semibold tracking-tight text-neutral-900 dark:text-white leading-6 mb-2" },
      "Pro plan",
    ),
    h("div", { ...loc(CARD, 5), className: "actions" }, h(Box, null, h(Button, null, "Buy"), h("span", loc(CARD, 6), "Billed yearly"))),
    h(Trigger, null, "Options"),
    h(
      "ul",
      loc(CARD, 8),
      [
        { plan: "free", features: ["sync", "export"] },
        { plan: "pro", features: ["sync", "export"] },
      ].map((p) => h(Row, { key: p.plan, ...p })),
    ),
  )
}

let root: Root
let stop: () => void
let sent: FromFrame[]
let container: HTMLElement

const render = (tree: ReactNode) => act(() => root.render(h("div", { id: "frame" }, tree)))

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("requestAnimationFrame", () => 0)
  vi.stubGlobal("cancelAnimationFrame", () => {})
  sent = []
  vi.spyOn(window, "postMessage").mockImplementation(((msg: FromFrame) => {
    sent.push(msg)
  }) as typeof window.postMessage)
  document.body.innerHTML = `<div id="root"></div>`
  root = createRoot(document.getElementById("root")!)
  await render(h(Card))
  container = document.getElementById("frame")!
  stop = startInspector(container, "Card")
})

afterEach(() => {
  stop()
  act(() => root.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// The context of an element, picked as the canvas does, without what jsdom
// can't measure (sizes and the viewport).
const contextOf = (el: Element | undefined) => {
  if (!el) throw new Error("no such element")
  document.elementsFromPoint = () => [el, container]
  const ask = (msg: object) =>
    window.dispatchEvent(
      new MessageEvent("message", { data: { ns: INSPECTOR_NS, ...msg }, origin: "https://canvas.test", source: window }),
    )
  ask({ type: "select-at", id: 1, x: 0, y: 0 })
  const ref = (sent.at(-1) as Extract<FromFrame, { type: "selected" }>).info!.ref
  ask({ type: "context", id: 2, refs: [ref] })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { size, margin, border, padding, viewport, ...rest } = (sent.at(-1) as Extract<FromFrame, { type: "context" }>)
    .contexts[0] as ElementContext
  return rest
}
const all = (selector: string) => [...container.querySelectorAll(selector)]
const withText = (selector: string, text: string) => all(selector).find((el) => el.textContent === text)

test("an element written in the previewed component", () => {
  expect(contextOf(all("h3")[0])).toMatchInlineSnapshot(`
    {
      "attributes": {},
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:4:5",
          "name": "Card",
        },
      ],
      "element": "h3#title.text-lg.font-semibold.tracking-tight.text-neutral-900.dark:text-white.leading-6",
      "loc": "src/components/user-components/Card.tsx:4:5",
      "repeat": null,
      "text": "Pro plan",
      "within": null,
    }
  `)
})

test("a shared component's element, used inside a wrapper that didn't render it", () => {
  expect(contextOf(withText(".btn", "Buy"))).toMatchInlineSnapshot(`
    {
      "attributes": {
        "data-slot": "button",
      },
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:5:5",
          "name": "Card",
        },
        {
          "loc": "src/components/ui/button.tsx:3:5",
          "name": "Button",
        },
      ],
      "element": "button.btn",
      "loc": "src/components/ui/button.tsx:3:5",
      "repeat": null,
      "text": "Buy",
      "within": null,
    }
  `)
})

test("an element the previewed component passes into a wrapper", () => {
  expect(contextOf(withText("span", "Billed yearly"))).toMatchInlineSnapshot(`
    {
      "attributes": {},
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:6:5",
          "name": "Card",
        },
      ],
      "element": "span",
      "loc": "src/components/user-components/Card.tsx:6:5",
      "repeat": null,
      "text": "Billed yearly",
      "within": null,
    }
  `)
})

test("a forwardRef component's element, with its open state", () => {
  expect(contextOf(withText("button", "Options"))).toMatchInlineSnapshot(`
    {
      "attributes": {
        "aria-expanded": "true",
        "data-slot": "dropdown-menu-trigger",
        "data-state": "open",
      },
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:3:5",
          "name": "Card",
        },
        {
          "loc": "src/components/ui/dropdown-menu.tsx:7:5",
          "name": "Trigger",
        },
      ],
      "element": "button",
      "loc": "src/components/ui/dropdown-menu.tsx:7:5",
      "repeat": null,
      "text": "Options",
      "within": null,
    }
  `)
})

test("a row of a list, rendered by a memo component", () => {
  expect(contextOf(all(`[data-ad-loc="${CARD}:9:5"]`)[1])).toMatchInlineSnapshot(`
    {
      "attributes": {},
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:8:5",
          "name": "Card",
        },
        {
          "loc": "src/components/user-components/Card.tsx:9:5",
          "name": "Row",
        },
      ],
      "element": "li",
      "loc": "src/components/user-components/Card.tsx:9:5",
      "repeat": {
        "count": 2,
        "index": 1,
        "keys": [
          "pro",
        ],
      },
      "text": "pro sync export Choose",
      "within": null,
    }
  `)
})

test("an item of a list inside an item of a list", () => {
  expect(contextOf(all(`[data-ad-loc="${CARD}:12:5"]`)[3])).toMatchInlineSnapshot(`
    {
      "attributes": {},
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:8:5",
          "name": "Card",
        },
        {
          "loc": "src/components/user-components/Card.tsx:12:5",
          "name": "Row",
        },
      ],
      "element": "li",
      "loc": "src/components/user-components/Card.tsx:12:5",
      "repeat": {
        "count": 4,
        "index": 3,
        "keys": [
          "pro",
          "export",
        ],
      },
      "text": "export",
      "within": null,
    }
  `)
})

test("a library's element inside a shared component, in a list", () => {
  expect(contextOf(withText(".btn", "Choose") && all(".btn")[2]!.querySelector("path")!)).toMatchInlineSnapshot(`
    {
      "attributes": {},
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:8:5",
          "name": "Card",
        },
        {
          "loc": "src/components/user-components/Card.tsx:9:5",
          "name": "Row",
        },
        {
          "loc": "src/components/ui/button.tsx:3:5",
          "name": "Button",
        },
        {
          "loc": null,
          "name": "Icon",
        },
      ],
      "element": "path",
      "loc": null,
      "repeat": {
        "count": 2,
        "index": 1,
        "keys": [
          "pro",
        ],
      },
      "text": "",
      "within": {
        "loc": "src/components/ui/button.tsx:3:5",
        "path": "svg > path",
      },
    }
  `)
})

test("an element in a frame the dev server didn't tag", async () => {
  const Badge = () => h("span", { className: "badge" }, "New")
  await render(h(function Plain() {
    return h("div", null, h(Badge))
  }))
  expect(contextOf(all(".badge")[0])).toMatchInlineSnapshot(`
    {
      "attributes": {},
      "components": [
        {
          "loc": null,
          "name": "Plain",
        },
        {
          "loc": null,
          "name": "Badge",
        },
      ],
      "element": "span.badge",
      "loc": null,
      "repeat": null,
      "text": "New",
      "within": null,
    }
  `)
})

test("a shared component written twice in one place isn't a list", async () => {
  await render(h(function Toolbar() {
    return h("div", loc(CARD, 3), h(Button, null, "Save"), h(Button, null, "Cancel"))
  }))
  expect(contextOf(withText(".btn", "Cancel"))).toMatchInlineSnapshot(`
    {
      "attributes": {
        "data-slot": "button",
      },
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:3:5",
          "name": "Toolbar",
        },
        {
          "loc": "src/components/ui/button.tsx:3:5",
          "name": "Button",
        },
      ],
      "element": "button.btn",
      "loc": "src/components/ui/button.tsx:3:5",
      "repeat": null,
      "text": "Cancel",
      "within": null,
    }
  `)
})

test("nor is it when the previewed component's root is a shared component", async () => {
  const Panel = ({ children }: { children: ReactNode }) => h("div", loc(BOX, 2), children)
  await render(h(function Form() {
    return h(Panel, null, h(Panel, null, h(Button, null, "Email")), h(Panel, null, h(Button, null, "Cancel"), h(Button, null, "Save")))
  }))
  expect(contextOf(withText(".btn", "Save"))).toMatchInlineSnapshot(`
    {
      "attributes": {
        "data-slot": "button",
      },
      "components": [
        {
          "loc": null,
          "name": "Form",
        },
        {
          "loc": "src/components/ui/button.tsx:3:5",
          "name": "Button",
        },
      ],
      "element": "button.btn",
      "loc": "src/components/ui/button.tsx:3:5",
      "repeat": null,
      "text": "Save",
      "within": null,
    }
  `)
})

test("a previewed component ending in a digit, and esbuild-renamed memo and forwardRef", async () => {
  // As esbuild writes `const H2 = forwardRef(function H2 …)` and
  // `const Plan2 = memo(function Plan2 …)`.
  const H2 = forwardRef<HTMLHeadingElement, { children: ReactNode }>(function H22({ children }, ref) {
    return h("h2", { ...loc(BOX, 4), ref }, children)
  })
  const Plan2 = memo(function Plan22() {
    return h("article", loc(CARD, 12), h(H2, null, "Team"))
  })
  function Hero2() {
    return h("section", loc(CARD, 3), h(Plan2))
  }
  // The preview loads the component it shows through lazy().
  const Lazy = lazy(async () => ({ default: Hero2 }))
  await act(async () => root.render(h("div", { id: "frame" }, h(Suspense, null, h(Lazy)))))
  expect(contextOf(all("h2")[0])).toMatchInlineSnapshot(`
    {
      "attributes": {},
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:3:5",
          "name": "Hero2",
        },
        {
          "loc": "src/components/user-components/Card.tsx:12:5",
          "name": "Plan2",
        },
        {
          "loc": "src/components/ui/box.tsx:4:5",
          "name": "H2",
        },
      ],
      "element": "h2",
      "loc": "src/components/ui/box.tsx:4:5",
      "repeat": null,
      "text": "Team",
      "within": null,
    }
  `)
})

test("a checkbox's state as the user left it", async () => {
  await render(h(function Settings() {
    const [on, setOn] = useState(true)
    return h("input", { ...loc(CARD, 9), type: "checkbox", checked: on, onChange: () => setOn(!on) })
  }))
  const box = all("input")[0] as HTMLInputElement
  expect(contextOf(box).attributes).toMatchInlineSnapshot(`
    {
      "checked": "",
      "type": "checkbox",
    }
  `)
  await act(async () => box.click())
  expect(box.checked).toBe(false)
  expect(contextOf(box).attributes).toMatchInlineSnapshot(`
    {
      "type": "checkbox",
    }
  `)
})

// A dialog as Radix renders one: the library's overlay and wrapper portaled
// to <body>, around content the previewed component wrote.
const DialogContent = ({ children }: { children: ReactNode }) =>
  createPortal(
    h("div", { className: "portal" }, h("div", { className: "overlay" }), h("div", { role: "dialog", className: "dialog" }, children)),
    document.body,
  )
function Settings() {
  return h(
    "section",
    loc(CARD, 3),
    h("button", loc(CARD, 4), "Edit profile"),
    h(DialogContent, null, h("h2", loc(CARD, 7), "Edit profile"), h("button", { ...loc(CARD, 9), className: "save" }, "Save")),
  )
}
const inPortal = (selector: string) => document.querySelector(`body > .portal ${selector}`)!

test("an element a portal put under <body>: the component's all the same", async () => {
  await render(h(Settings))
  expect(contextOf(inPortal(".save"))).toMatchInlineSnapshot(`
    {
      "attributes": {},
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:9:5",
          "name": "Settings",
        },
      ],
      "element": "button.save",
      "loc": "src/components/user-components/Card.tsx:9:5",
      "repeat": null,
      "text": "Save",
      "within": null,
    }
  `)
})

test("a library's element in a portal, placed from the element the portal was rendered from", async () => {
  await render(h(Settings))
  expect(contextOf(inPortal(".dialog"))).toMatchInlineSnapshot(`
    {
      "attributes": {
        "role": "dialog",
      },
      "components": [
        {
          "loc": "src/components/user-components/Card.tsx:3:5",
          "name": "Settings",
        },
        {
          "loc": null,
          "name": "DialogContent",
        },
      ],
      "element": "div.dialog",
      "loc": null,
      "repeat": null,
      "text": "Edit profile Save",
      "within": {
        "loc": "src/components/user-components/Card.tsx:3:5",
        "path": "(portal) div > div:nth-of-type(2)",
      },
    }
  `)
})

test("walks out of a portal to the element it was rendered from, and finds a portal's element again", async () => {
  await render(h(Settings))
  const ask = (msg: object) =>
    window.dispatchEvent(
      new MessageEvent("message", { data: { ns: INSPECTOR_NS, ...msg }, origin: "https://canvas.test", source: window }),
    )
  const said = () => {
    const info = (sent.at(-1) as Extract<FromFrame, { type: "selected" }>).info
    return info && `${info.tag} ${JSON.stringify(info.text)} at ${info.ref.loc}, path ${info.ref.path.join("/")}`
  }
  document.elementsFromPoint = () => [inPortal(".save"), document.body]
  ask({ type: "select-at", id: 1, x: 0, y: 0 })
  const ref = (sent.at(-1) as Extract<FromFrame, { type: "selected" }>).info!.ref
  const steps = [said()]
  for (const id of [2, 3, 4]) {
    ask({ type: "walk", id, dir: "parent" })
    steps.push(said())
  }
  ask({ type: "select", id: 5, ref })
  steps.push(said())
  expect(steps).toMatchInlineSnapshot(`
    [
      "button "Save" at src/components/user-components/Card.tsx:9:5, path -1/1/1/1",
      "div "Edit profile Save" at null, path -1/1/1",
      "div "Edit profile Save" at null, path -1/1",
      "section "Edit profile" at src/components/user-components/Card.tsx:3:5, path 0",
      "button "Save" at src/components/user-components/Card.tsx:9:5, path -1/1/1/1",
    ]
  `)
})

test("looks under the point as DevTools does: pointer-events: none hides nothing", async () => {
  await render(h(Settings))
  let forced: boolean | undefined
  document.elementsFromPoint = () => {
    forced = [...document.head.querySelectorAll("style")].some((s) => s.textContent?.includes("pointer-events: auto !important"))
    return [inPortal(".save"), document.body]
  }
  window.dispatchEvent(
    new MessageEvent("message", { data: { ns: INSPECTOR_NS, type: "hit", id: 1, x: 0, y: 0 }, origin: "https://canvas.test", source: window }),
  )
  expect({ forcedWhileLooking: forced, leftBehind: document.head.querySelectorAll("style").length }).toMatchInlineSnapshot(`
    {
      "forcedWhileLooking": true,
      "leftBehind": 0,
    }
  `)
})
