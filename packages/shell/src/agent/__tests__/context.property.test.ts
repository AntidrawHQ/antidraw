// @vitest-environment jsdom
import fc from "fast-check"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../agent"
import { markupOf, openingTag } from "../markup"
import {
  AGENT_NS,
  SOURCE_ATTRIBUTE,
  type ElementContext,
  type ElementInfo,
  type ElementRef,
  type FromFrame,
  type ToFrame,
} from "../protocol"

// Thousands of random frames each: seconds alone, more beside the rest of
// the suite.
vi.setConfig({ testTimeout: 30_000 })

// What the inspector tells an agent about each element of a random frame.
// Each case is a model of the code (JSX written in the frame's component and
// in a few others, the call sites of those components, .map()s), rendered to
// the DOM as React and the dev server would: a DOM element written in a
// tagged file takes its location (data-ad-loc), a <Comp> variable tag
// nothing. A library's file isn't tagged, and an untagged frame has no
// stamps at all. Rendering, the model notes what the DOM doesn't hold: which
// JSX node each element came from, and the located element around it. That's
// the truth the answers are held to.

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
// A library's file is untagged.
type Component = { library: boolean; body: Node }
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
    library: fc.nat(3).map((n) => n === 0),
    body: fc.oneof(
      tree(i).node,
      el(tree(i).children.map((children): Node[] => [{ kind: "slot" }, ...children])),
    ),
  })

// A list the previewed component renders itself, whose rows hold a list of
// their own, or a component each.
const ownList: fc.Arbitrary<Node> = fc.record({
  kind: fc.constant("map" as const),
  count: fc.integer({ min: 2, max: 4 }),
  item: el(
    fc.array(
      fc.oneof(
        tree(COMPONENTS).node,
        fc.record({ kind: fc.constant("map" as const), count: fc.integer({ min: 2, max: 3 }), item: el(fc.constant([])) }),
        fc.record({ kind: fc.constant("use" as const), comp: fc.nat(COMPONENTS - 1), children: fc.constant<Node[]>([]) }),
      ),
      { minLength: 1, maxLength: 3 },
    ),
  ),
})

const cases: fc.Arbitrary<Case> = fc.record({
  tagged: fc.oneof({ weight: 9, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
  components: fc.tuple(...Array.from({ length: COMPONENTS }, (_, i) => component(i))),
  root: fc.array(fc.oneof({ weight: 3, arbitrary: tree(COMPONENTS).node }, { weight: 1, arbitrary: ownList }), {
    minLength: 1,
    maxLength: 4,
  }),
  outside: fc.array(fc.nat(), { maxLength: 3 }),
})

// ── Rendering, and the truth ───────────────────────────────────────────────

type Rendered = {
  el: Element
  loc: string | null
  // The JSX node it came from.
  site: string
  // The nearest element around it with a location, inside the component.
  around: Rendered | null
  // What it's counted by: itself if it has a location, else `around`.
  anchor: Rendered | null
  name: string
}
type Ctx = {
  def: number
  tagged: boolean
  slot: { nodes: Node[]; ctx: Ctx } | null
}
type At = { parent: Element; around: Rendered | null }

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
        const loc = node.kind === "el" && ctx.tagged ? site.loc : null
        if (loc) el.setAttribute(SOURCE_ATTRIBUTE, loc)
        if (node.text) el.append(node.text)
        at.parent.append(el)
        const r: Rendered = { el, loc, site: site.key, around: at.around, anchor: null, name }
        r.anchor = loc ? r : at.around
        rendered.push(r)
        for (const child of node.children) render(child, ctx, { parent: el, around: loc ? r : at.around })
        return
      }
      case "use": {
        const comp = c.components[node.comp]!
        return render(comp.body, { def: node.comp, tagged: c.tagged && !comp.library, slot: { nodes: node.children, ctx } }, at)
      }
      case "map":
        for (let i = 0; i < node.count; i++) render(node.item, ctx, at)
        return
      case "slot":
        if (ctx.slot && firstSlot.get(ctx.def) === node) for (const n of ctx.slot.nodes) render(n, ctx.slot.ctx, at)
        return
    }
  }
  const own: Ctx = { def: -1, tagged: c.tagged, slot: null }
  for (const node of c.root) render(node, own, { parent: container, around: null })

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

  return { container, rendered, outside }
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
  window.dispatchEvent(new MessageEvent("message", { data: { ns: AGENT_NS, ...msg }, origin: CANVAS, source: window }))
  return sent.at(-1)!
}
// What a click with Inspect on picks there.
const infoAt = (el: Element) => {
  at = el
  ask({ type: "tool", id: 1, tool: "inspect", wheel: "pass", zoom: 1 })
  document.querySelector("antidraw-agent")!.shadowRoot!.querySelector(".catcher")!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }))
  return (sent.at(-1) as Extract<FromFrame, { type: "selected" }>).info
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

// The truth, from the model: where each element was written and the located
// elements around it, in document order (the order they were rendered).
const fileOfLoc = (loc: string) => loc.replace(/:\d+:\d+$/, "")
const isOwn = (r: Rendered) => !!r.loc && fileOfLoc(r.loc) === OWN
const arounds = (r: Rendered) => {
  const all: Rendered[] = []
  for (let a = r.around; a; a = a.around) all.push(a)
  return all
}
const truth = (rendered: Rendered[]) => {
  const located = rendered.filter((r) => r.loc)
  // Which of those written where `r` is it is, inside `scope` (or anywhere).
  const ordinal = (r: Rendered, scope: Rendered | null) => {
    const all = located.filter((o) => o.loc === r.loc && (!scope || arounds(o).includes(scope)))
    return { index: all.indexOf(r), count: all.length }
  }
  const repeat = (a: Rendered) => {
    if (!isOwn(a)) return []
    const isItem = (o: Rendered) => isOwn(o) && located.filter((x) => x.loc === o.loc).length > 1
    const levels: { loc: string; index: number; count: number }[] = []
    for (let item: Rendered | null = a; item; ) {
      const scope: Rendered | null = arounds(item).find(isItem) ?? null
      levels.push({ loc: item.loc!, ...ordinal(item, scope) })
      item = scope
    }
    const kept = levels.filter((l, i) => i === 0 || l.count > 1)
    return kept.length > 1 || (kept[0]?.count ?? 0) > 1 ? kept : []
  }
  const path = (a: Rendered) => {
    if (isOwn(a)) return []
    const steps = [a]
    for (const o of arounds(a)) {
      if (isOwn(steps.at(-1)!)) break
      if (fileOfLoc(o.loc!) !== fileOfLoc(steps.at(-1)!.loc!)) steps.push(o)
    }
    return steps.map((step, i) => ({ loc: step.loc!, ...ordinal(step, steps[i + 1] ?? null) }))
  }
  return { repeat, path }
}

// Which item of a list an element is, for one written in the previewed
// component: counted inside the item of the list around it, and that item
// in its own list, out to the outermost. One written elsewhere is placed by
// its path instead, never called a list: two uses of a component aren't one.
test("says which item of a list it is, inside the list it's in", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ container, rendered }) => {
        const { repeat } = truth(rendered)
        const answers = new Map(rendered.map((r) => [r, contextAt(r.el)]))
        for (const r of rendered) {
          const why = `${r.el.outerHTML}\nin\n${container.innerHTML}`
          const answer = answers.get(r)!.repeat
          expect(answer, why).toEqual(r.anchor ? repeat(r.anchor) : [])
          // The rest is the outer item's own: the item around it.
          if (answer.length > 1) {
            const outer = arounds(r.anchor!).find((o) => o.loc === answer[1]!.loc)
            expect(outer, why).toBeDefined()
            expect(answers.get(outer!)!.repeat, why).toEqual(answer.slice(1))
          }
        }
      }),
    ),
    { numRuns: 150 },
  )
})

// From where it's written out to the previewed component, a file at a time.
test("gives the path from where it's written out to the previewed component", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ container, rendered }) => {
        const { path } = truth(rendered)
        for (const r of rendered) {
          const why = `${r.el.outerHTML}\nin\n${container.innerHTML}`
          const answer = contextAt(r.el).path
          expect(answer, why).toEqual(r.anchor ? path(r.anchor) : [])
          // A file at a time, and the previewed component's only last.
          answer.slice(1).forEach((step, i) => expect(fileOfLoc(step.loc), why).not.toBe(fileOfLoc(answer[i]!.loc)))
          answer.slice(0, -1).forEach((step) => expect(fileOfLoc(step.loc), why).not.toBe(OWN))
        }
      }),
    ),
    { numRuns: 150 },
  )
})

// What the agent can't tell apart it can't act on: two elements written in
// the same place (a component used twice, a list's rows, a component in each
// row) get different answers.
test("tells apart every two elements written in the same place", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ container, rendered }) => {
        const said = new Map<string, Rendered>()
        for (const r of rendered.filter((r) => r.loc)) {
          const { path, repeat } = contextAt(r.el)
          const key = JSON.stringify([r.loc, path, repeat])
          const other = said.get(key)
          expect(other, `${r.el.outerHTML} and ${other?.el.outerHTML} both said ${key}\nin\n${container.innerHTML}`).toBeUndefined()
          said.set(key, r)
        }
      }),
    ),
    { numRuns: 150 },
  )
})

// One a library rendered has no location: which of its kind its parent holds.
test("says which of its kind in its parent an element without a location is", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ rendered }) => {
        for (const r of rendered) {
          const { sibling } = contextAt(r.el)
          const like = [...r.el.parentElement!.children].filter((e) => e.localName === r.el.localName)
          expect(sibling, r.el.outerHTML).toEqual(!r.loc && like.length > 1 ? { index: like.indexOf(r.el), count: like.length } : null)
        }
      }),
    ),
    { numRuns: 100 },
  )
})

test("places an element without a location of its own inside the nearest one in the component that has one", () => {
  fc.assert(
    fc.property(cases, (c) =>
      inFrame(c, ({ rendered }) => {
        for (const r of rendered) {
          const { within } = contextAt(r.el)
          expect(within, r.el.outerHTML).toBe(r.loc ? null : r.around && openingTag(r.around.el))
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
          const picked = infoAt(r.el)!
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
  // True lists of a few sizes, lists in lists, one place used from two,
  // a shared component in each row of a list, paths through a few files,
  // unstamped wrappers and siblings, untagged frames and identical siblings,
  // or the properties above say little.
  const samples = fc.sample(cases, { numRuns: 500, seed: 1 }).map((c) => ({ c, ...build(c) }))
  const seen = (pred: (s: (typeof samples)[number]) => boolean) => samples.filter(pred).length
  const facts = samples.map((s) => {
    const { repeat, path } = truth(s.rendered)
    const all = new Set<string>()
    for (const r of s.rendered.filter((r) => r.loc)) {
      const levels = repeat(r)
      if (levels.length) all.add(`list of ${Math.min(levels[0]!.count, 4)}`)
      if (levels.length > 1) all.add("list in a list")
      const steps = path(r)
      if (steps.length > 2) all.add("path through 3 files")
      if (steps.some((step) => step.count > 1)) all.add("look-alikes told apart by the path")
      if (steps.length && isOwn(s.rendered.find((o) => o.loc === steps.at(-1)!.loc)!) && steps.at(-1)!.count > 1)
        all.add("in each row of a list")
      if (steps.length && !steps.some((step) => fileOfLoc(step.loc) === OWN)) all.add("path with nothing of the component's")
    }
    if (s.rendered.some((r) => !r.loc && [...r.el.parentElement!.children].filter((e) => e.localName === r.el.localName).length > 1))
      all.add("unlocated siblings")
    if (s.c.tagged && s.rendered.some((r) => !r.loc && r.el.querySelector(`[${SOURCE_ATTRIBUTE}]`))) all.add("unstamped wrapper")
    if (!s.c.tagged && s.rendered.length > 2) all.add("untagged")
    if (s.rendered.some((r) => r.el.classList.length > 6)) all.add("many classes")
    if (s.outside.length > 2) all.add("outside")
    return all
  })
  const expected = [
    "list of 2",
    "list of 3",
    "list of 4",
    "list in a list",
    "path through 3 files",
    "look-alikes told apart by the path",
    "in each row of a list",
    "path with nothing of the component's",
    "unlocated siblings",
    "unstamped wrapper",
    "untagged",
    "many classes",
    "outside",
  ]
  const count = (fact: string) => facts.filter((f) => f.has(fact)).length
  expect(Object.fromEntries(expected.map((f) => [f, count(f) > 25]))).toEqual(Object.fromEntries(expected.map((f) => [f, true])))
  expect(seen(() => true)).toBe(500)
})
