// @vitest-environment jsdom
import fc from "fast-check"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../src/inspector/agent"
import { markupOf, openingTag } from "../src/inspector/markup"
import {
  INSPECTOR_NS,
  SOURCE_ATTRIBUTE,
  USE_ATTRIBUTE,
  type ElementContext,
  type ElementInfo,
  type ElementRef,
  type FromFrame,
  type ToFrame,
} from "../src/inspector/protocol"

// What the inspector tells an agent about each element of a random frame.
// Each case is a model of the code (JSX written in the frame's component and
// in a few others, the call sites of those components, .map()s), rendered to
// the DOM as React and the dev server would: a DOM element written in a
// tagged file takes its location (data-ad-loc), a <Comp> variable tag only a
// use (data-ad-use), and a component's use reaches the DOM where it spreads
// its props. A library's file isn't tagged, and an untagged frame has no
// stamps at all. Rendering, the model notes what the DOM can't hold: which
// JSX node each element came from, through which call sites, and which of
// those call sites the DOM shows around it. That's the truth the answers are
// held to.

const CANVAS = "https://canvas.test"
const OWN = "src/components/user-components/Gen.tsx"
// Outside the component: the app's root, and an element beside the frame.
const MAIN = "src/main.tsx"
const fileOf = (def: number) => (def < 0 ? OWN : `src/components/ui/part${def}.tsx`)

type Node =
  | { kind: "el"; tag: string; id: string; classes: string[]; text: string; spread: boolean; children: Node[] }
  // <Tag> where const Tag = as ?? "section": a use, no location.
  | { kind: "as"; tag: string; text: string; children: Node[] }
  | { kind: "use"; comp: number; children: Node[] }
  | { kind: "map"; count: number; item: Node }
  // {children}, where the component puts what it's given.
  | { kind: "slot" }
// A library is untagged, and spreads its props, if it does, on its root
// (Radix's Slot). A tagged component spreads them on each element marked.
type Component = { library: boolean; passes: boolean; body: Node }
type Case = { tagged: boolean; components: Component[]; root: Node[]; outside: number[] }

const COMPONENTS = 3
const tag = fc.constantFrom("div", "li", "span", "button", "p")
const text = fc.constantFrom("", "Item", "Buy")
const CLASSES = ["a", "b", "c", "d", "e", "f", "g", "h"]
const el = (children: fc.Arbitrary<Node[]>) =>
  fc.record({
    kind: fc.constant("el" as const),
    tag,
    id: fc.constantFrom("", "", "buy"),
    // Past six, the name leaves the rest out.
    classes: fc.oneof(
      { weight: 4, arbitrary: fc.uniqueArray(fc.constantFrom(...CLASSES), { maxLength: 3 }) },
      { weight: 1, arbitrary: fc.shuffledSubarray(CLASSES, { minLength: 7 }) },
    ),
    text,
    spread: fc.boolean(),
    children,
  })

// The JSX of a component that can use the first `components` others.
const tree = (components: number) =>
  fc.letrec<{ node: Node; children: Node[] }>((tie) => ({
    node: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      { weight: 3, arbitrary: el(fc.constant([])) },
      { weight: 4, arbitrary: el(tie("children")) },
      { weight: 1, arbitrary: fc.record({ kind: fc.constant("as" as const), tag, text, children: tie("children") }) },
      ...(components
        ? [
            {
              weight: 4,
              arbitrary: fc.record({
                kind: fc.constant("use" as const),
                comp: fc.nat(components - 1),
                children: tie("children"),
              }),
            },
          ]
        : []),
      { weight: 3, arbitrary: fc.record({ kind: fc.constant("map" as const), count: fc.nat(4), item: tie("node") }) },
      { weight: 2, arbitrary: fc.record({ kind: fc.constant("slot" as const) }) },
    ),
    children: fc.array(tie("node"), { maxLength: 3 }),
  }))

// Often a wrapper around what it's given (a tooltip's trigger, a card).
const component = (i: number) =>
  fc.record({
    library: fc.nat(2).map((n) => n === 0),
    passes: fc.boolean(),
    body: fc.oneof(
      tree(i).node,
      el(tree(i).children.map((children): Node[] => [{ kind: "slot" }, ...children])),
    ),
  })

const cases: fc.Arbitrary<Case> = fc.record({
  tagged: fc.oneof({ weight: 9, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
  components: fc.tuple(...Array.from({ length: COMPONENTS }, (_, i) => component(i))),
  root: fc.array(tree(COMPONENTS).node, { minLength: 1, maxLength: 4 }),
  outside: fc.array(fc.nat(), { maxLength: 3 }),
})

// ── Rendering, and the truth ───────────────────────────────────────────────

// A call site the element was rendered through. What the DOM shows of it is
// read off the DOM (usesOn, below).
type Frame = { site: string }
type Rendered = {
  el: Element
  loc: string | null
  stamped: boolean
  // The JSX node it came from, and the call sites it was used through.
  site: string
  chain: string
  // The nearest element around it with a location, inside the component.
  around: Element | null
  // The nearest element at or around it with either stamp: what it's counted
  // by. And the one around that.
  anchor: Rendered | null
  outer: Rendered | null
  name: string
}
type Ctx = {
  def: number
  tagged: boolean
  library: boolean
  root: Node | null
  chain: Frame[]
  // The use this instance's props carry, if it passes them on.
  passes: string | null
  slot: { nodes: Node[]; ctx: Ctx } | null
}
type At = { parent: Element; around: Element | null; anchor: Rendered | null }

// So many elements a case, whatever the maps multiply to.
const BUDGET = 60

const build = (c: Case) => {
  // Each JSX node's place: a line of its component's file.
  const sites = new Map<Node, { key: string; loc: string }>()
  const firstSlot = new Map<number, Node>()
  const number = (def: number, body: Node[]) => {
    let line = 0
    const walk = (n: Node) => {
      line++
      if (!sites.has(n)) sites.set(n, { key: `${def}:${line}`, loc: `${fileOf(def)}:${line}:5` })
      if (n.kind === "slot") {
        if (!firstSlot.has(def)) firstSlot.set(def, n)
      } else if (n.kind === "map") walk(n.item)
      else n.children.forEach(walk)
    }
    body.forEach(walk)
  }
  c.components.forEach((comp, i) => number(i, [comp.body]))
  number(-1, c.root)

  document.body.innerHTML = ""
  const app = document.createElement("div")
  app.id = "root"
  app.setAttribute(SOURCE_ATTRIBUTE, `${MAIN}:1:1`)
  const container = document.createElement("div")
  container.id = "frame"
  const beside = document.createElement("aside")
  beside.setAttribute(SOURCE_ATTRIBUTE, `${MAIN}:2:1`)
  beside.textContent = "Item"
  app.append(container, beside)
  document.body.append(app)

  const rendered: Rendered[] = []
  const render = (node: Node, ctx: Ctx, at: At): void => {
    switch (node.kind) {
      case "el":
      case "as": {
        if (rendered.length >= BUDGET) return
        const site = sites.get(node)!
        const el = document.createElement(node.tag)
        let name = node.tag
        if (node.kind === "el") {
          if (node.id) el.id = node.id
          if (node.classes.length) el.className = node.classes.join(" ")
          name += (node.id ? `#${node.id}` : "") + node.classes.slice(0, 6).map((cl) => `.${cl}`).join("")
        }
        const spread =
          node.kind === "el" && ctx.passes !== null && (ctx.library ? node === ctx.root : node.spread)
        const loc = node.kind === "el" && ctx.tagged ? site.loc : null
        const use = node.kind === "as" ? (ctx.tagged ? site.loc : null) : spread ? ctx.passes : null
        if (loc) el.setAttribute(SOURCE_ATTRIBUTE, loc)
        if (use) el.setAttribute(USE_ATTRIBUTE, use)
        if (node.text) el.append(node.text)
        at.parent.append(el)
        const chain = ctx.chain
        const r: Rendered = {
          el,
          loc,
          stamped: !!(loc || use),
          site: site.key,
          chain: chain.map((f) => f.site).join(" "),
          around: at.around,
          anchor: at.anchor,
          outer: at.anchor,
          name,
        }
        if (r.stamped) r.anchor = r
        rendered.push(r)
        const inner = { ...ctx, chain }
        for (const child of node.children) render(child, inner, { parent: el, around: loc ? el : at.around, anchor: r.anchor })
        return
      }
      case "use": {
        const comp = c.components[node.comp]!
        const site = sites.get(node)!
        const use = ctx.tagged ? site.loc : null
        return render(
          comp.body,
          {
            def: node.comp,
            tagged: c.tagged && !comp.library,
            library: comp.library,
            root: comp.body,
            chain: [...ctx.chain, { site: site.key }],
            passes: comp.passes && use ? use : null,
            slot: { nodes: node.children, ctx },
          },
          at,
        )
      }
      case "map":
        for (let i = 0; i < node.count; i++) render(node.item, ctx, at)
        return
      case "slot":
        if (ctx.slot && firstSlot.get(ctx.def) === node) for (const n of ctx.slot.nodes) render(n, ctx.slot.ctx, at)
        return
    }
  }
  const own: Ctx = { def: -1, tagged: c.tagged, library: false, root: null, chain: [], passes: null, slot: null }
  for (const node of c.root) render(node, own, { parent: container, around: null, anchor: null })

  // Copies of the component's elements outside it, stamps and all, beside
  // the frame and under <body>: none of them counts.
  const outside: Element[] = [beside]
  c.outside.forEach((n, i) => {
    const source = rendered[n % Math.max(rendered.length, 1)]?.el
    const copy = source ? (source.cloneNode(true) as Element) : document.createElement("aside")
    if (i % 2) app.append(copy)
    else document.body.prepend(copy)
    outside.push(copy, ...copy.querySelectorAll("*"))
  })

  // In document order, grouped: a true list's items share the JSX node and
  // the call sites (they differ only in the maps' iterations); look-alikes
  // share the JSX node and what the DOM shows of the call sites, the uses on
  // and around them. A child passed into a component that spreads its props
  // sits inside that use as much as the component's own elements do.
  const usesOn = (el: Element) => {
    const uses: string[] = []
    for (let node: Element | null = el; node && node !== container; node = node.parentElement) {
      const use = node.getAttribute(USE_ATTRIBUTE)
      if (use) uses.push(use)
    }
    return uses.join(" ")
  }
  const anchors = rendered.filter((r) => r.stamped)
  const group = (key: (r: Rendered) => string) => {
    const groups = new Map<string, Rendered[]>()
    for (const r of anchors) groups.set(key(r), [...(groups.get(key(r)) ?? []), r])
    return (r: Rendered) => groups.get(key(r))!
  }
  return {
    container,
    rendered,
    outside,
    listOf: group((r) => `${r.site} ${r.chain}`),
    alikesOf: group((r) => `${r.site} ${usesOn(r.el)}`),
  }
}

// ── Driving the inspector ──────────────────────────────────────────────────

let sent: FromFrame[]
let at: Element | null

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0)
  vi.stubGlobal("cancelAnimationFrame", () => {})
  // What's under the point: the element the test names and those around it.
  document.elementsFromPoint = () => {
    const under: Element[] = []
    for (let node = at; node; node = node.parentElement) under.push(node)
    return under
  }
  vi.spyOn(window, "postMessage").mockImplementation(((msg: FromFrame) => {
    sent.push(msg)
  }) as typeof window.postMessage)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const ask = (msg: ToFrame) => {
  window.dispatchEvent(new MessageEvent("message", { data: { ns: INSPECTOR_NS, ...msg }, origin: CANVAS, source: window }))
  return sent.at(-1)!
}
const infoAt = (el: Element, type: "hit" | "select-at" = "hit") => {
  at = el
  return (ask({ type, id: 1, x: 0, y: 0 }) as Extract<FromFrame, { info: unknown }>).info
}
const select = (ref: ElementRef) => (ask({ type: "select", id: 2, ref }) as Extract<FromFrame, { type: "selected" }>).info
const contextOf = (ref: ElementRef): ElementContext | null =>
  (ask({ type: "context", id: 3, refs: [ref] }) as Extract<FromFrame, { type: "context" }>).contexts[0]!
const contextAt = (el: Element) => {
  const info = infoAt(el)
  expect(info, el.outerHTML).not.toBeNull()
  return contextOf((info as ElementInfo).ref)!
}

const inFrame = (c: Case, check: (frame: ReturnType<typeof build>) => void) => {
  const frame = build(c)
  sent = []
  const stop = startInspector(frame.container, "Gen")
  try {
    check(frame)
  } finally {
    stop()
  }
}

// ── Properties ─────────────────────────────────────────────────────────────

// An element is counted by its anchor: itself if it carries a stamp, else
// the nearest element around it that does. So a library's unstamped <span>
// inside the second <li> of a list is "1 of n", the <li>'s place. A list in
// a list counts its items across the outer one, in document order (a
// table's cells, row after row): they're written in one place and used from
// one place, and the agent counts them in the order the markup shows them.
// A component used from two places renders two things, never a list, where
// the DOM shows the two uses on or around the element (it spreads its props
// there). Where it can't (one that doesn't pass its props on leaves the same
// stamps from both), the look-alikes may be counted together: there, a true
// list's count is at least its own and at most the look-alikes', and a
// look-alike that's in no list may be counted with the others or not (where
// the uses around it tell it apart: one inside the other, say).
test("counts a list's items in document order, and nothing the DOM tells apart", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ container, rendered, listOf, alikesOf }) => {
        const answers = new Map(rendered.map((r) => [r, contextAt(r.el).repeat]))
        for (const r of rendered) {
          const repeat = answers.get(r)!
          const why = `${r.el.outerHTML}\nin\n${container.innerHTML}`
          if (!r.anchor) {
            expect(repeat, why).toBeNull()
            continue
          }
          const list = listOf(r.anchor)
          const alikes = alikesOf(r.anchor)
          if (alikes.length === list.length) {
            expect(repeat, why).toEqual(list.length > 1 ? { index: list.indexOf(r.anchor), count: list.length } : null)
          } else if (list.length > 1) {
            expect(repeat, why).not.toBeNull()
            expect(repeat!.count, why).toBeGreaterThanOrEqual(list.length)
            expect(repeat!.count, why).toBeLessThanOrEqual(alikes.length)
          } else if (repeat) {
            expect(repeat.count, why).toBeLessThanOrEqual(alikes.length)
          }
        }
        // Across a list, each index once: 0 to n - 1 where nothing looks like
        // its items.
        for (const r of rendered.filter((r) => r.stamped)) {
          const list = listOf(r)
          if (list.length < 2) continue
          const indices = list.map((a) => answers.get(a)!.index).sort((a, b) => a - b)
          if (alikesOf(r).length === list.length) expect(indices).toEqual(list.map((_, i) => i))
          else expect(new Set(indices).size).toBe(indices.length)
        }
      }),
    ),
    { numRuns: 150 },
  )
})

test("places an element without a location of its own inside the nearest one in the component that has one", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ rendered }) => {
        for (const r of rendered) {
          const { within } = contextAt(r.el)
          expect(within, r.el.outerHTML).toBe(r.loc ? null : r.around && openingTag(r.around))
          // Never the app's root around the frame.
          expect(within ?? "").not.toContain(MAIN)
        }
      }),
    ),
    { numRuns: 150 },
  )
})

// Maps make siblings with the same location, tag and text: only the index
// tells them apart.
test("names every element by a ref that finds it again, with its markup", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ container, rendered }) => {
        for (const r of rendered) {
          const picked = infoAt(r.el, "select-at")!
          expect(picked, r.el.outerHTML).not.toBeNull()
          const { ref } = picked
          expect(ref).toMatchObject({ loc: r.loc, tag: r.el.localName })
          expect(ref.path.reduce<Element | undefined>((node, i) => node?.children[i], container)).toBe(r.el)
          expect(select(ref)).toEqual(picked)
          const context = contextOf(ref)
          expect(context?.html).toBe(markupOf(r.el))
          expect(context?.element).toBe(r.name)
        }
      }),
    ),
    { numRuns: 150 },
  )
})

test("answers nothing for elements outside the component, or a ref to nothing", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ container, outside }) => {
        for (const el of outside) {
          expect(infoAt(el), el.outerHTML).toBeNull()
          expect(infoAt(el, "select-at"), el.outerHTML).toBeNull()
        }
        const nothing = [
          { loc: `${MAIN}:2:1`, index: 0, path: [container.children.length], tag: "aside", text: "Item" },
          { loc: null, index: 0, path: [container.children.length + 1], tag: "div" },
          { loc: `${OWN}:99:5`, index: 3, path: [0, 99], tag: "li" },
        ]
        for (const ref of nothing) expect(contextOf(ref), JSON.stringify(ref)).toBeNull()
      }),
    ),
    { numRuns: 100 },
  )
})

test("generates the cases that matter", () => {
  // True lists of a few sizes, lists in lists, one place used from two, the
  // look-alikes the DOM can't tell apart and the ones it can, uses with no
  // location, unstamped wrappers, untagged frames and identical siblings,
  // or the properties above say little.
  const samples = fc.sample(cases, { numRuns: 500, seed: 1 }).map((c) => ({ c, ...build(c) }))
  const seen = (pred: (s: (typeof samples)[number]) => boolean) => samples.filter(pred).length
  const lists = (s: (typeof samples)[number]) => s.rendered.filter((r) => r.stamped).map((r) => s.listOf(r).length)
  expect(seen((s) => lists(s).includes(2))).toBeGreaterThan(25)
  expect(seen((s) => lists(s).includes(3))).toBeGreaterThan(25)
  expect(seen((s) => lists(s).some((n) => n >= 4))).toBeGreaterThan(25)
  expect(
    seen((s) => s.rendered.some((r) => r.stamped && r.outer && s.listOf(r).length > 1 && s.listOf(r.outer).length > 1)),
  ).toBeGreaterThan(25)
  expect(
    seen((s) => s.rendered.some((r) => r.stamped && s.rendered.some((o) => o.stamped && o.site === r.site && o.chain !== r.chain))),
  ).toBeGreaterThan(25)
  expect(seen((s) => s.rendered.some((r) => r.stamped && s.alikesOf(r).length > s.listOf(r).length))).toBeGreaterThan(25)
  // The same JSX node through two call sites the DOM shows.
  expect(
    seen((s) =>
      s.rendered.some(
        (r) => r.stamped && s.rendered.some((o) => o.stamped && o.site === r.site && !s.alikesOf(r).includes(o)),
      ),
    ),
  ).toBeGreaterThan(25)
  expect(seen((s) => s.rendered.some((r) => r.stamped && !r.loc))).toBeGreaterThan(25)
  expect(
    seen((s) => s.c.tagged && s.rendered.some((r) => !r.stamped && r.el.querySelector(`[${SOURCE_ATTRIBUTE}]`))),
  ).toBeGreaterThan(25)
  expect(seen((s) => !s.c.tagged && s.rendered.length > 2)).toBeGreaterThan(25)
  expect(
    seen((s) =>
      s.rendered.some((r) => {
        const next = r.el.nextElementSibling
        return !!r.loc && !!next && next.getAttribute(SOURCE_ATTRIBUTE) === r.loc && next.textContent === r.el.textContent
      }),
    ),
  ).toBeGreaterThan(25)
  expect(seen((s) => s.rendered.some((r) => r.el.classList.length > 6))).toBeGreaterThan(25)
  expect(seen((s) => s.outside.length > 2)).toBeGreaterThan(25)
})
