// @vitest-environment jsdom
import { act, createElement as h, forwardRef, memo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../src/inspector/agent"
import { INSPECTOR_NS, type ElementContext, type FromFrame } from "../src/inspector/protocol"

// What an agent is told about elements of a real React tree: their markup,
// with where each is written and used, and which item of a list it is. The
// stamps are written by hand here, as the dev server's tagger would: a DOM
// element's location, and a component's use, which a shared component
// passes on to its element ({...props}, as shadcn's do).

const CARD = "src/components/user-components/Card.tsx"
const BUTTON = "src/components/ui/button.tsx"
const BOX = "src/components/ui/box.tsx"
const MENU = "src/components/ui/dropdown-menu.tsx"
const loc = (file: string, line: number) => ({ "data-ad-loc": `${file}:${line}:5` })
const use = (file: string, line: number) => ({ "data-ad-use": `${file}:${line}:9` })
type Props = { children?: ReactNode; [attribute: `data-${string}`]: string }

// A library icon: nothing the dev server stamped.
const Icon = () => h("svg", null, h("path"))
const Button = ({ children, ...props }: Props) =>
  h("button", { ...loc(BUTTON, 3), className: "btn", "data-slot": "button", ...props }, h(Icon), children)
// Holds what it's given; it didn't render it.
const Box = ({ children }: { children: ReactNode }) => h("div", { ...loc(BOX, 2), className: "box" }, children)
const Trigger = forwardRef<HTMLButtonElement, Props>(function Trigger({ children, ...props }, ref) {
  return h(
    "button",
    { ...loc(MENU, 7), ref, "data-slot": "dropdown-menu-trigger", "data-state": "open", "aria-expanded": "true", ...props },
    children,
  )
})
const Row = memo(function Row({ plan, features }: { plan: string; features: string[] }) {
  return h(
    "li",
    loc(CARD, 9),
    h("h4", loc(CARD, 10), plan),
    h("ul", loc(CARD, 11), features.map((f) => h("li", { ...loc(CARD, 12), key: f }, f))),
    h(Button, use(CARD, 13), "Choose"),
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
    h("div", { ...loc(CARD, 5), className: "actions" }, h(Box, null, h(Button, use(CARD, 5), "Buy"), h("span", loc(CARD, 6), "Billed yearly"))),
    h(Trigger, use(CARD, 7), "Options"),
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
      "element": "h3#title.text-lg.font-semibold.tracking-tight.text-neutral-900.dark:text-white.leading-6",
      "html": "<h3 data-ad-loc="src/components/user-components/Card.tsx:4:5" id="title" class="text-lg font-semibold tracking-tight text-neutral-900 dark:text-white leading-6 mb-2">Pro plan</h3>",
      "repeat": null,
      "within": null,
    }
  `)
})

test("a shared component's element, used inside a wrapper that didn't render it", () => {
  expect(contextOf(withText(".btn", "Buy"))).toMatchInlineSnapshot(`
    {
      "element": "button.btn",
      "html": "<button data-ad-loc="src/components/ui/button.tsx:3:5" class="btn" data-slot="button" data-ad-use="src/components/user-components/Card.tsx:5:9">
      <svg>…</svg>
      Buy
    </button>",
      "repeat": null,
      "within": null,
    }
  `)
})

test("an element the previewed component passes into a wrapper", () => {
  expect(contextOf(withText("span", "Billed yearly"))).toMatchInlineSnapshot(`
    {
      "element": "span",
      "html": "<span data-ad-loc="src/components/user-components/Card.tsx:6:5">Billed yearly</span>",
      "repeat": null,
      "within": null,
    }
  `)
})

test("a forwardRef component's element, with its open state", () => {
  expect(contextOf(withText("button", "Options"))).toMatchInlineSnapshot(`
    {
      "element": "button",
      "html": "<button data-ad-loc="src/components/ui/dropdown-menu.tsx:7:5" data-slot="dropdown-menu-trigger" data-state="open" aria-expanded="true" data-ad-use="src/components/user-components/Card.tsx:7:9">Options</button>",
      "repeat": null,
      "within": null,
    }
  `)
})

test("a row of a list, rendered by a memo component", () => {
  expect(contextOf(all(`[data-ad-loc="${CARD}:9:5"]`)[1])).toMatchInlineSnapshot(`
    {
      "element": "li",
      "html": "<li data-ad-loc="src/components/user-components/Card.tsx:9:5">
      <h4 data-ad-loc="src/components/user-components/Card.tsx:10:5">pro</h4>
      <ul data-ad-loc="src/components/user-components/Card.tsx:11:5">
        <li data-ad-loc="src/components/user-components/Card.tsx:12:5">sync</li>
        <li data-ad-loc="src/components/user-components/Card.tsx:12:5">export</li>
      </ul>
      <button data-ad-loc="src/components/ui/button.tsx:3:5" class="btn" data-slot="button" data-ad-use="src/components/user-components/Card.tsx:13:9">
        <svg>…</svg>
        Choose
      </button>
    </li>",
      "repeat": {
        "count": 2,
        "index": 1,
      },
      "within": null,
    }
  `)
})

test("an item of a list inside an item of a list", () => {
  expect(contextOf(all(`[data-ad-loc="${CARD}:12:5"]`)[3])).toMatchInlineSnapshot(`
    {
      "element": "li",
      "html": "<li data-ad-loc="src/components/user-components/Card.tsx:12:5">export</li>",
      "repeat": {
        "count": 4,
        "index": 3,
      },
      "within": null,
    }
  `)
})

test("a library's element inside a shared component, in a list", () => {
  expect(contextOf(withText(".btn", "Choose") && all(".btn")[2]!.querySelector("path")!)).toMatchInlineSnapshot(`
    {
      "element": "path",
      "html": "<path></path>",
      "repeat": {
        "count": 2,
        "index": 1,
      },
      "within": "<button data-ad-loc="src/components/ui/button.tsx:3:5" class="btn" data-slot="button" data-ad-use="src/components/user-components/Card.tsx:13:9">",
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
      "element": "span.badge",
      "html": "<span class="badge">New</span>",
      "repeat": null,
      "within": null,
    }
  `)
})

test("a shared component used twice isn't a list", async () => {
  await render(h(function Toolbar() {
    return h("div", loc(CARD, 3), h(Button, use(CARD, 4), "Save"), h(Button, use(CARD, 5), "Cancel"))
  }))
  expect(contextOf(withText(".btn", "Cancel"))).toMatchInlineSnapshot(`
    {
      "element": "button.btn",
      "html": "<button data-ad-loc="src/components/ui/button.tsx:3:5" class="btn" data-slot="button" data-ad-use="src/components/user-components/Card.tsx:5:9">
      <svg>…</svg>
      Cancel
    </button>",
      "repeat": null,
      "within": null,
    }
  `)
})

test("nor is it when the previewed component's root is a shared component", async () => {
  const Panel = ({ children }: { children: ReactNode }) => h("div", loc(BOX, 2), children)
  await render(h(function Form() {
    return h(
      Panel,
      null,
      h(Panel, null, h(Button, use(CARD, 5), "Email")),
      h(Panel, null, h(Button, use(CARD, 6), "Cancel"), h(Button, use(CARD, 7), "Save")),
    )
  }))
  expect(contextOf(withText(".btn", "Save"))).toMatchInlineSnapshot(`
    {
      "element": "button.btn",
      "html": "<button data-ad-loc="src/components/ui/button.tsx:3:5" class="btn" data-slot="button" data-ad-use="src/components/user-components/Card.tsx:7:9">
      <svg>…</svg>
      Save
    </button>",
      "repeat": null,
      "within": null,
    }
  `)
})

test("a list of a shared component that renders through a variable: told apart by its use", async () => {
  // shadcn's `const Comp = asChild ? Slot : "span"`: the tagger can't stamp
  // <Comp> as a DOM element, so only the use reaches it.
  const Chip = ({ children, ...props }: Props) => {
    const Comp = "span"
    return h(Comp, { className: "chip", ...props }, children)
  }
  await render(h(function Tags() {
    return h(
      "div",
      loc(CARD, 3),
      ["new", "sale", "hot"].map((t) => h(Chip, { key: t, ...use(CARD, 4) }, t)),
      h(Chip, use(CARD, 5), "more"),
    )
  }))
  expect(contextOf(withText(".chip", "sale"))).toMatchInlineSnapshot(`
    {
      "element": "span.chip",
      "html": "<span class="chip" data-ad-use="src/components/user-components/Card.tsx:4:9">sale</span>",
      "repeat": {
        "count": 3,
        "index": 1,
      },
      "within": "<div data-ad-loc="src/components/user-components/Card.tsx:3:5">",
    }
  `)
})

test("a checkbox's state as the user left it", async () => {
  await render(h(function Settings() {
    const [on, setOn] = useState(true)
    return h("input", { ...loc(CARD, 9), type: "checkbox", checked: on, onChange: () => setOn(!on) })
  }))
  const box = all("input")[0] as HTMLInputElement
  expect(contextOf(box).html).toMatchInlineSnapshot(`"<input data-ad-loc="src/components/user-components/Card.tsx:9:5" type="checkbox" checked>"`)
  await act(async () => box.click())
  expect(box.checked).toBe(false)
  expect(contextOf(box).html).toMatchInlineSnapshot(`"<input data-ad-loc="src/components/user-components/Card.tsx:9:5" type="checkbox">"`)
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
      "element": "button.save",
      "html": "<button data-ad-loc="src/components/user-components/Card.tsx:9:5" class="save">Save</button>",
      "repeat": null,
      "within": null,
    }
  `)
})

test("a library's element in a portal, placed from the element the portal was rendered from", async () => {
  await render(h(Settings))
  expect(contextOf(inPortal(".dialog"))).toMatchInlineSnapshot(`
    {
      "element": "div.dialog",
      "html": "<div role="dialog" class="dialog">
      <h2 data-ad-loc="src/components/user-components/Card.tsx:7:5">Edit profile</h2>
      <button data-ad-loc="src/components/user-components/Card.tsx:9:5" class="save">Save</button>
    </div>",
      "repeat": null,
      "within": "<section data-ad-loc="src/components/user-components/Card.tsx:3:5">",
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
