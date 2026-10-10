// @vitest-environment jsdom
import fc from "fast-check"
import { expect, test } from "vitest"
import { markupOf, openingTag } from "../src/inspector/markup"

// Random DOM trees through the markup an agent is given. Each case is a model
// of a tree, built with the DOM API the way a page's script builds it: text
// nodes side by side, comments, checkboxes whose state moved off their
// attribute, drawings and code inside svg, script, style and template. The
// output is then read back as HTML, as a browser would, and held against the
// tree it came from.

// The limits, as markup.ts has them.
const DEPTH = 3
const CHILDREN = 8
const LINES = 60
const TEXT = 80
const VALUE = 200

const VOID = new Set(["br", "hr", "img", "input"])
const OPAQUE = new Set(["svg", "script", "style", "template"])
const SVG = "http://www.w3.org/2000/svg"
// Written only inside svg, script, style and template, so it must never be
// read in the output.
const INSIDE = "zq-inside"

type Attr = { name: string; value: string }
type Model =
  | { kind: "text"; text: string }
  | { kind: "comment"; text: string }
  | { kind: "el"; tag: string; attrs: Attr[]; children: Model[] }
  | {
      kind: "input"
      type: "checkbox" | "radio" | "text"
      attrs: Attr[]
      // The checked attribute as set, then the property as set after it (null:
      // left alone, so it follows the attribute).
      checkedAttr: string | null
      checked: boolean | null
      group: boolean
    }
  | { kind: "svg"; attrs: Attr[]; drawing: ("path" | "g" | "ws" | "text")[] }
  | { kind: "code"; tag: "script" | "style"; attrs: Attr[]; code: string }
  // A template's inside goes in its childNodes when a script appends it (as
  // React does) and in its .content when the HTML parser reads it.
  | { kind: "template"; attrs: Attr[]; into: "childNodes" | "content"; inside: ("text" | "span" | "ws" | "comment")[] }

// Characters of two UTF-16 units, and one of four: clipping must not end
// between the halves.
const ASTRAL = ["😀", "𝒳", "🎨", "👍🏽"]
const FILL = "lorem ipsum dolor sit amet consectetur adipiscing elit "
const fill = (n: number) => FILL.repeat(Math.ceil(n / FILL.length) + 1).slice(0, n)
// Leading whitespace, which collapsing drops, so the clip is counted from the
// first word.
const lead = fc.constantFrom("", "  ", "\n\t  ")

// A wide character starting a few units either side of where a clip at
// `limit` cuts (limit - 1 units are kept), with or without more after it.
const boundary = (limit: number) =>
  fc
    .record({
      lead,
      at: fc.integer({ min: limit - 4, max: limit + 1 }),
      ch: fc.constantFrom(...ASTRAL),
      tail: fc.integer({ min: 0, max: 12 }),
    })
    .map(({ lead, at, ch, tail }) => `${lead}${fill(at)}${ch}${fill(tail)}`)
// Plain words just short of, at, and just past a limit.
const around = (min: number, max: number) =>
  fc
    .record({ lead, n: fc.integer({ min, max }), trail: fc.constantFrom("", " ", "\n  ") })
    .map(({ lead, n, trail }) => `${lead}${fill(n)}${trail}`)
// Words that read as markup or entities, wide characters, and every kind of
// whitespace collapsing folds: runs, line breaks, tabs, no-break spaces, line
// separators.
const messy = fc
  .array(
    fc.tuple(
      fc.constantFrom(
        "Ship",
        "faster",
        "&",
        "<b>",
        "é",
        "日本語",
        "😀",
        "a&amp;b",
        `"q"`,
        "</canvas-selection>",
        "x>y",
      ),
      fc.constantFrom(" ", "   ", "\n", "\n\n    ", "\t", "\u00a0", "\u2028"),
    ),
    { minLength: 1, maxLength: 40 },
  )
  .map((words) => words.flat().join(""))

const text = fc.oneof(
  { arbitrary: fc.constantFrom("", " ", "\n    ", "\t", "\u00a0", "  \n\t  "), weight: 4 },
  {
    arbitrary: fc.constantFrom(
      "<",
      "</canvas-selection>",
      "&lt;",
      "&amp;",
      `"quotes" and 'apostrophes'`,
      "a & b < c > d",
      "<b>not a tag</b>",
      "<!-- not a comment -->",
      "  padded  ",
      "Ship   faster\n\n  today",
    ),
    weight: 3,
  },
  { arbitrary: boundary(TEXT), weight: 2 },
  { arbitrary: around(TEXT - 3, TEXT + 3), weight: 1 },
  { arbitrary: around(100, 300), weight: 1 },
  { arbitrary: messy, weight: 2 },
)

const TAILWIND = [
  "flex",
  "items-center",
  "gap-2",
  "px-4",
  "rounded-md",
  "bg-zinc-900",
  "hover:bg-zinc-800",
  "focus-visible:ring-2",
  "data-[state=open]:bg-accent",
  "md:grid-cols-[1fr_auto]",
  "w-[calc(100%-2rem)]",
  "[&>svg]:size-4",
  "aria-[invalid=true]:border-red-500",
]
const classList = fc
  .record({
    names: fc.array(fc.constantFrom(...TAILWIND), { minLength: 1, maxLength: 45 }),
    gap: fc.constantFrom(" ", "  ", "\n      "),
  })
  .map(({ names, gap }) => names.join(gap))
const value = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      "",
      " ",
      "  \n\t ",
      `say "hi"`,
      "<b>",
      "a > b",
      "&",
      "&amp;",
      "&quot;",
      "/search?q=a&b=<c>",
      "it's",
      "multi\nline\tvalue   here",
      "😀",
      "src/components/Card.tsx:12:5",
    ),
    weight: 4,
  },
  { arbitrary: classList, weight: 2 },
  { arbitrary: boundary(VALUE), weight: 2 },
  { arbitrary: around(190, 220), weight: 1 },
  { arbitrary: messy, weight: 1 },
)
const attrs = fc.uniqueArray(
  fc.record({
    name: fc.constantFrom(
      "class",
      "id",
      "data-ad-loc",
      "data-state",
      "aria-label",
      "aria-hidden",
      "style",
      "href",
      "title",
      "hidden",
      "role",
    ),
    value,
  }),
  { selector: (a) => a.name, maxLength: 5 },
)

const comment = fc.record({
  kind: fc.constant("comment" as const),
  text: fc.constantFrom("", " note ", "<div>", "a--b"),
})
const leaf = fc.oneof(
  fc.record({
    kind: fc.constant("el" as const),
    tag: fc.constantFrom("img", "br"),
    attrs,
    children: fc.constant<Model[]>([]),
  }),
  fc.record({
    kind: fc.constant("input" as const),
    type: fc.constantFrom("checkbox" as const, "radio" as const, "text" as const),
    attrs,
    checkedAttr: fc.option(fc.constantFrom("", "checked", "false")),
    checked: fc.option(fc.boolean()),
    group: fc.boolean(),
  }),
)
const svg = fc.record({
  kind: fc.constant("svg" as const),
  attrs: fc
    .tuple(
      fc.subarray([
        { name: "xmlns", value: SVG },
        { name: "viewBox", value: "0 0 24 24" },
        { name: "preserveAspectRatio", value: "xMidYMid meet" },
        { name: "fill", value: "none" },
        { name: "stroke-width", value: "2" },
      ]),
      fc.option(classList),
    )
    .map(([fixed, cls]) => (cls === null ? fixed : [{ name: "class", value: cls }, ...fixed])),
  drawing: fc.array(fc.constantFrom("path" as const, "g" as const, "ws" as const, "text" as const), { maxLength: 4 }),
})
const code = fc.record({
  kind: fc.constant("code" as const),
  tag: fc.constantFrom("script" as const, "style" as const),
  attrs,
  code: fc.constantFrom(
    "",
    "  \n  ",
    `if (a < b && c > d) console.log("${INSIDE}")`,
    `</script><b>${INSIDE}</b>`,
    `.${INSIDE} > a { content: "</style>" }`,
  ),
})
const template = fc.record({
  kind: fc.constant("template" as const),
  attrs,
  into: fc.constantFrom("childNodes" as const, "content" as const),
  inside: fc.array(fc.constantFrom("text" as const, "span" as const, "ws" as const, "comment" as const), {
    maxLength: 3,
  }),
})

// Children: a few, several, or more than are shown.
const some = <T>(item: fc.Arbitrary<T>) =>
  fc.oneof(
    { withCrossShrink: true },
    { arbitrary: fc.array(item, { maxLength: 4, depthIdentifier: "tree" }), weight: 3 },
    { arbitrary: fc.array(item, { minLength: 2, maxLength: CHILDREN, depthIdentifier: "tree" }), weight: 2 },
    { arbitrary: fc.array(item, { minLength: CHILDREN + 1, maxLength: 15, depthIdentifier: "tree" }), weight: 1 },
  )

// Only what the HTML parser builds back as it was: block elements hold
// anything, inline ones (and p) only inline content, ul only li, and no a in
// an a or button in a button. The first choice is text, all that's left at
// the deepest level.
type Trees = { flow: Model; li: Model; phrasing: Model; inA: Model; inButton: Model; inBoth: Model; root: Model }
type Context = Exclude<keyof Trees, "root">
const trees = fc.letrec<Trees>((tie) => {
  const el = (tags: string[], inside: Context, children = some(tie(inside))) =>
    fc.record({ kind: fc.constant("el" as const), tag: fc.constantFrom(...tags), attrs, children })
  const inline = { span: el(["span", "b", "em"], "phrasing"), a: el(["a"], "inA"), button: el(["button"], "inButton") }
  const node = (...containers: fc.Arbitrary<Model>[]) =>
    fc.oneof(
      { depthSize: "large", maxDepth: 7, depthIdentifier: "tree", withCrossShrink: true },
      { arbitrary: text.map((text) => ({ kind: "text" as const, text })), weight: 4 },
      { arbitrary: comment, weight: 1 },
      { arbitrary: leaf, weight: 2 },
      { arbitrary: fc.oneof(svg, code, template), weight: 1 },
      ...containers.map((arbitrary) => ({ arbitrary, weight: 2 })),
    )
  const block = el(["div", "section", "article", "my-el"], "flow")
  const list = el(["ul"], "li")
  const paragraph = el(["p", "my-el"], "phrasing")
  const hr = fc.record({
    kind: fc.constant("el" as const),
    tag: fc.constant("hr"),
    attrs,
    children: fc.constant<Model[]>([]),
  })
  return {
    flow: node(block, block, list, paragraph, inline.span, inline.a, inline.button, hr),
    li: fc.oneof(
      { depthSize: "small", maxDepth: 7, depthIdentifier: "tree" },
      fc.record({ kind: fc.constant("text" as const), text: fc.constantFrom("", "\n  ") }),
      comment,
      el(["li"], "flow"),
    ),
    phrasing: node(el(["span", "b", "em", "my-el"], "phrasing"), inline.a, inline.button),
    inA: node(el(["span", "b", "em"], "inA"), el(["button"], "inBoth")),
    inButton: node(el(["span", "b", "em"], "inButton"), el(["a"], "inBoth")),
    inBoth: node(el(["span", "b", "em"], "inBoth")),
    // The element inspected: any element, mostly one holding others.
    root: fc.oneof(
      { withCrossShrink: true },
      { arbitrary: block, weight: 4 },
      { arbitrary: el(["div", "section"], "flow", fc.array(tie("flow"), { minLength: 5, maxLength: 15 })), weight: 4 },
      { arbitrary: list, weight: 1 },
      { arbitrary: paragraph, weight: 1 },
      { arbitrary: fc.oneof(inline.span, inline.a, inline.button), weight: 1 },
      { arbitrary: fc.oneof(leaf, svg, code, template), weight: 1 },
    ),
  }
})
const tree = trees.root

const setAttrs = (el: Element, list: Attr[]) => list.forEach(({ name, value }) => el.setAttribute(name, value))

const build = (model: Model): Node => {
  switch (model.kind) {
    case "text":
      return document.createTextNode(model.text)
    case "comment":
      return document.createComment(model.text)
    case "el": {
      const el = document.createElement(model.tag)
      setAttrs(el, model.attrs)
      el.append(...model.children.map(build))
      return el
    }
    case "input": {
      const el = document.createElement("input")
      el.setAttribute("type", model.type)
      // First, so that showing the live state means moving it.
      if (model.checkedAttr !== null) el.setAttribute("checked", model.checkedAttr)
      if (model.type === "radio" && model.group) el.setAttribute("name", "group")
      setAttrs(el, model.attrs)
      if (model.checked !== null) el.checked = model.checked
      return el
    }
    case "svg": {
      const el = document.createElementNS(SVG, "svg")
      setAttrs(el, model.attrs)
      const path = () => {
        const p = document.createElementNS(SVG, "path")
        p.setAttribute("d", "M5 12h14")
        p.setAttribute("data-x", INSIDE)
        return p
      }
      for (const part of model.drawing) {
        if (part === "path") el.append(path())
        else if (part === "g") el.appendChild(document.createElementNS(SVG, "g")).append(path())
        else el.append(document.createTextNode(part === "ws" ? "\n  " : INSIDE))
      }
      return el
    }
    case "code": {
      const el = document.createElement(model.tag)
      setAttrs(el, model.attrs)
      if (model.code) el.append(document.createTextNode(model.code))
      return el
    }
    case "template": {
      const el = document.createElement("template")
      setAttrs(el, model.attrs)
      const into = model.into === "content" ? el.content : el
      for (const part of model.inside) {
        if (part === "span") into.appendChild(document.createElement("span")).append(INSIDE)
        else if (part === "comment") into.append(document.createComment(INSIDE))
        else into.append(document.createTextNode(part === "ws" ? " \n " : INSIDE))
      }
      return el
    }
  }
}
const rootOf = (model: Model) => build(model) as Element

// What markup.ts shows of an element: its elements and the texts that aren't
// only whitespace, attributes collapsed and clipped. A checkbox's or radio's
// checked attribute gives way to its live state, written last.
const collapse = (s: string) => s.replace(/\s+/g, " ").trim()
const isElement = (n: Node): n is Element => n.nodeType === Node.ELEMENT_NODE
const shownable = (el: Element) =>
  [...(el instanceof HTMLTemplateElement ? el.content.childNodes : []), ...el.childNodes].filter(
    (n) => isElement(n) || (n.nodeType === Node.TEXT_NODE && collapse(n.nodeValue!) !== ""),
  )
const isToggle = (el: Element): el is HTMLInputElement =>
  el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")
const attributesOf = (el: Element) => {
  const all = [...el.attributes].map((a) => [a.name, a.value] as const)
  if (!isToggle(el)) return all
  return [...all.filter(([name]) => name !== "checked"), ...(el.checked ? [["checked", ""] as const] : [])]
}
const walk = (el: Element): Element[] => [el, ...[...el.children].flatMap(walk)]

// A clipped string is the whole if it fits, else a start of it and "…", in at
// most `max` units. A clip may keep one unit fewer than max - 1 (not to end
// between a surrogate pair's halves), never more or fewer.
const expectClipped = (out: string, whole: string, max: number, what: string) => {
  if (whole.length <= max) return expect(out, what).toBe(whole)
  expect(out.endsWith("…"), `${what}: ${JSON.stringify(out)} ends with …`).toBe(true)
  expect(out.length, what).toBeLessThanOrEqual(max)
  expect(out.length, what).toBeGreaterThanOrEqual(max - 1)
  expect(whole.startsWith(out.slice(0, -1)), `${what}: ${JSON.stringify(out)} starts ${JSON.stringify(whole)}`).toBe(
    true,
  )
}

// The output read back as HTML, the way a browser reads it, in a template so
// nothing in it runs or loads. Each "… N more" line becomes a comment holding
// its count and line number, so it stays where it was among the children.
const MORE = /^( *)… (\d+) more$/
const parse = (out: string) => {
  const t = document.createElement("template")
  t.innerHTML = out
    .split("\n")
    .map((line, i) => line.replace(MORE, `$1<!--more $2 ${i}-->`))
    .join("\n")
  const top = [...t.content.childNodes].filter((n) => isElement(n) || collapse(n.nodeValue ?? "") !== "")
  expect(top).toHaveLength(1)
  return top[0] as Element
}
const inside = (el: Element) => (el instanceof HTMLTemplateElement ? el.content.childNodes : el.childNodes)

// A read-back element's children as the lines they were: elements, texts
// (each its own line, so split where the lines broke) and counts.
type Item = { kind: "el"; el: Element } | { kind: "text"; text: string } | { kind: "more"; count: number; line: number }
const items = (el: Element): Item[] =>
  [...inside(el)].flatMap((n): Item[] => {
    if (isElement(n)) return [{ kind: "el", el: n }]
    if (n.nodeType === Node.COMMENT_NODE) {
      const [, count, line] = /^more (\d+) (\d+)$/.exec(n.nodeValue!)!
      return [{ kind: "more", count: Number(count), line: Number(line) }]
    }
    return n
      .nodeValue!.split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ kind: "text", text }))
  })
const kindOf = (item: Item | Node) =>
  "kind" in item
    ? item.kind === "el"
      ? `<${item.el.localName}>`
      : item.kind
    : isElement(item)
      ? `<${item.localName}>`
      : "text"

// The read-back element `b` against the element `a` it came from, `depth`
// levels below the root: same tag, same attributes in the same order with
// their values clipped, and its children a start of a's, the rest counted.
const expectPruned = (a: Element, b: Element, depth: number) => {
  const where = `${a.localName} at depth ${depth}`
  expect(b.localName, where).toBe(a.localName)
  const want = attributesOf(a)
  expect(
    [...b.attributes].map((x) => x.name),
    where,
  ).toEqual(want.map(([name]) => name))
  want.forEach(([name, value], i) =>
    expectClipped(b.attributes[i]!.value, collapse(value), VALUE, `${where} [${name}]`),
  )
  if (VOID.has(a.localName)) return
  const children = shownable(a)
  const raw = [...inside(b)].map((n) => n.nodeValue)
  if (!children.length) return expect(raw, where).toEqual([])
  // Code, a drawing, or below the deepest level shown: one "…".
  if (OPAQUE.has(a.localName) || depth >= DEPTH) return expect(raw, where).toEqual(["…"])
  // A lone text, on the element's line.
  const only = children.length === 1 ? children[0]! : null
  if (only && !isElement(only)) {
    expect(raw, where).toHaveLength(1)
    return expectClipped(raw[0]!, collapse(only.nodeValue!), TEXT, `${where} text`)
  }
  const got = items(b)
  const more = got.at(-1)?.kind === "more" ? (got.pop() as Extract<Item, { kind: "more" }>) : null
  expect(got.map(kindOf), where).not.toContain("more")
  const shown = children.length - (more?.count ?? 0)
  expect(shown, where).toBeLessThanOrEqual(CHILDREN)
  if (more) {
    expect(more.count, where).toBeGreaterThan(0)
    expect(shown, where).toBeGreaterThanOrEqual(0)
    // Cut short only by the limit across, or by the whole having reached its
    // lines before this count was written.
    expect(shown === CHILDREN || more.line >= LINES, `${where}: ${shown} shown, count on line ${more.line}`).toBe(true)
  }
  const kept = children.slice(0, shown)
  expect(got.map(kindOf), where).toEqual(kept.map(kindOf))
  kept.forEach((child, i) => {
    const item = got[i]!
    if (item.kind === "el") expectPruned(child as Element, item.el, depth + 1)
    else if (item.kind === "text") expectClipped(item.text, collapse(child.nodeValue!), TEXT, `${where} text ${i}`)
  })
}

// Everything about a tree, the parts outerHTML leaves out too: a template's
// childNodes and an input's live state.
const dump = (n: Node): unknown =>
  isElement(n)
    ? {
        tag: n.localName,
        attrs: [...n.attributes].map((a) => [a.name, a.value]),
        checked: n instanceof HTMLInputElement ? n.checked : null,
        children: [...n.childNodes].map(dump),
        content: n instanceof HTMLTemplateElement ? [...n.content.childNodes].map(dump) : null,
      }
    : [n.nodeType, n.nodeValue]

const RUNS = 300

test("stops adding at sixty lines, then only closes what's open", () => {
  // Bound: every line is pushed one at a time, and a child is only started
  // while fewer than LINES lines are written. A child's write pushes its
  // first line before looking at its own children, so once the LINES-th line
  // is in, no child starts anywhere and each element whose children are still
  // being written adds at most a "… N more" line and its closing tag. Those
  // are the elements printing children, at depths 0 to DEPTH - 1 (one at
  // DEPTH prints as one line), so at most DEPTH of them: LINES + 2 * DEPTH
  // lines in all.
  fc.assert(
    fc.property(tree, (model) => {
      const lines = markupOf(rootOf(model)).split("\n")
      expect(lines.length).toBeLessThanOrEqual(LINES + 2 * DEPTH)
      for (const line of lines.slice(LINES)) expect(line).toMatch(/^ *(… \d+ more|<\/[a-z-]+>)$/)
    }),
    { numRuns: RUNS },
  )
})

test("reaches that bound: a count and a close for each of three open elements", () => {
  // Nine across at every level: the sixtieth line is the second text of the
  // sixth list at depth 2, and its parents each still have children to count.
  const grid = document.createElement("div")
  for (let i = 0; i < 9; i++) {
    const row = grid.appendChild(document.createElement("div"))
    for (let j = 0; j < 9; j++) {
      const cell = row.appendChild(document.createElement("div"))
      for (let k = 0; k < 9; k++) cell.append(`t${k}`, document.createComment("apart"))
    }
  }
  const lines = markupOf(grid).split("\n")
  expect(lines).toHaveLength(LINES + 2 * DEPTH)
  expect(lines.slice(LINES - 1)).toEqual([
    "      t1",
    "      … 7 more",
    "    </div>",
    "    … 3 more",
    "  </div>",
    "  … 8 more",
    "</div>",
  ])
})

test("nests two spaces a level, at most three levels down, one line each", () => {
  fc.assert(
    fc.property(tree, (model) => {
      const out = markupOf(rootOf(model))
      // Collapsed: no whitespace but spaces and the breaks between lines.
      expect(out).not.toMatch(/[^\S \n]/)
      const open: string[] = []
      for (const line of out.split("\n")) {
        const [, indent, content] = /^( *)(.*)$/.exec(line)!
        expect(indent.length % 2, line).toBe(0)
        expect(content, line).toMatch(/^\S/)
        const level = indent.length / 2
        expect(level, line).toBeLessThanOrEqual(DEPTH)
        if (content.startsWith("</")) {
          expect(level, line).toBe(open.length - 1)
          expect(content).toBe(`</${open.pop()}>`)
          continue
        }
        expect(level, line).toBe(open.length)
        // An opening tag alone on its line opens a level; it's never at the
        // deepest, where an element with children is one line.
        const tag = /^<([a-zA-Z][^\s>]*)/.exec(content)?.[1]
        if (tag && !VOID.has(tag) && !content.endsWith(`</${tag}>`)) {
          expect(level, line).toBeLessThan(DEPTH)
          open.push(tag)
        }
      }
      expect(open).toEqual([])
    }),
    { numRuns: RUNS },
  )
})

test("prunes the tree and invents nothing: read back, it's the start of each element's children", () => {
  fc.assert(
    fc.property(tree, (model) => {
      const el = rootOf(model)
      expectPruned(el, parse(markupOf(el)), 0)
    }),
    { numRuns: RUNS },
  )
})

test("never ends a clip between the halves of a character", () => {
  fc.assert(
    fc.property(tree, (model) => {
      const out = markupOf(rootOf(model))
      const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.exec(out)
      expect(lone && JSON.stringify(out.slice(Math.max(0, lone.index - 8), lone.index + 3))).toBeNull()
    }),
    { numRuns: RUNS },
  )
})

test("shows a checkbox or radio as checked when it is, whatever its attribute says", () => {
  fc.assert(
    fc.property(tree, (model) => {
      const el = rootOf(model)
      for (const input of walk(el).filter(isToggle)) {
        const names = [...openingTag(input).matchAll(/ ([^\s=">]+)(="[^"]*")?/g)].map((m) => m[1])
        expect(names.filter((name) => name === "checked")).toEqual(input.checked ? ["checked"] : [])
        if (input.checked) expect(openingTag(input).endsWith(" checked>")).toBe(true)
      }
    }),
    { numRuns: RUNS },
  )
})

test("prints svg, script, style and template as one line, their insides left out", () => {
  fc.assert(
    fc.property(tree, (model) => {
      const out = markupOf(rootOf(model))
      expect(out).not.toContain(INSIDE)
      for (const line of out.split("\n")) {
        const tag = /^ *<(svg|script|style|template)[ >]/.exec(line)?.[1]
        if (tag) expect(line).toMatch(new RegExp(`^ *<${tag}( [^]*)?>…?</${tag}>$`))
      }
    }),
    { numRuns: RUNS },
  )
})

test("counts a template's parsed content as content", () => {
  // Read from HTML, a template's inside is in its .content, not its children;
  // it is no more empty than one a script filled.
  fc.assert(
    fc.property(template, (model) => {
      const el = rootOf(model)
      const filled = [...el.childNodes, ...(el as HTMLTemplateElement).content.childNodes].some(
        (n) => isElement(n) || (n.nodeType === Node.TEXT_NODE && collapse(n.nodeValue!) !== ""),
      )
      expect(markupOf(el)).toBe(`${openingTag(el)}${filled ? "…" : ""}</template>`)
    }),
  )
})

test("leaves the tree as it was, gives the same each time, and starts with the opening tag", () => {
  fc.assert(
    fc.property(tree, (model) => {
      const el = rootOf(model)
      const before = dump(el)
      const html = el.outerHTML
      const out = markupOf(el)
      expect(el.outerHTML).toBe(html)
      expect(dump(el)).toEqual(before)
      expect(markupOf(el)).toBe(out)
      expect(out.startsWith(openingTag(el))).toBe(true)
    }),
    { numRuns: RUNS },
  )
})

test("can't break out of the message: every < in it starts a tag", () => {
  // The shell indents the output, so no line starts a tag at the message's
  // margin. And as text and values escape their "<", each one left is an
  // element's opening tag or closing tag read back.
  const tags = (el: Element): number =>
    (VOID.has(el.localName) ? 1 : 2) + [...inside(el)].filter(isElement).reduce((n, c) => n + tags(c), 0)
  fc.assert(
    fc.property(tree, (model) => {
      const out = markupOf(rootOf(model))
      for (const line of out.split("\n")) expect(`  ${line}`).not.toMatch(/^</)
      expect(out.split("<").length - 1).toBe(tags(parse(out)))
    }),
    { numRuns: RUNS },
  )
})

test("generates the cases that matter", () => {
  // The trees reach every limit and every hostile input, or the properties
  // above say little.
  const samples = fc.sample(tree, { numRuns: 300, seed: 1 }).map((model) => {
    const el = rootOf(model)
    return { el, all: walk(el), lines: markupOf(el).split("\n") }
  })
  const seen = (pred: (s: (typeof samples)[number]) => boolean) => samples.filter(pred).length
  const texts = (s: (typeof samples)[number]) =>
    s.all.flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.nodeValue!))
  const values = (s: (typeof samples)[number]) => s.all.flatMap((el) => [...el.attributes].map((a) => a.value))
  // A pair's high half where a clip keeps its last unit.
  const splits = (max: number) => (s: string) => {
    const c = collapse(s)
    return c.length > max && /[\uD800-\uDBFF]/.test(c[max - 2]!)
  }
  const depth = (el: Element): number => 1 + Math.max(0, ...[...el.children].map(depth))
  const more = (s: (typeof samples)[number]) => s.lines.flatMap((line, i) => (MORE.test(line) ? [i] : []))

  // The limits: lines, across (a count before the line budget is spent),
  // down, and small trees too.
  expect(seen((s) => s.lines.length > LINES)).toBeGreaterThan(30)
  expect(seen((s) => s.lines.length === LINES + 2 * DEPTH)).toBeGreaterThan(5)
  expect(seen((s) => more(s).some((i) => i >= LINES))).toBeGreaterThan(30)
  expect(seen((s) => more(s).some((i) => i < LINES))).toBeGreaterThan(30)
  expect(
    seen((s) => s.lines.some((line) => /^ {6}<(?!svg|script|style|template)[^/].*>…<\//.test(line))),
  ).toBeGreaterThan(30)
  expect(seen((s) => depth(s.el) >= 6)).toBeGreaterThan(15)
  expect(seen((s) => s.all.some((el) => el.childNodes.length >= 12))).toBeGreaterThan(30)
  expect(seen((s) => s.lines.length <= 5)).toBeGreaterThan(30)
  // Hostile text: clips through a wide character, lengths at the limit,
  // tag-like text, text side by side (comments between them count too),
  // blank text.
  expect(seen((s) => texts(s).some(splits(TEXT)))).toBeGreaterThan(15)
  expect(seen((s) => texts(s).some((t) => Math.abs(collapse(t).length - TEXT) <= 2))).toBeGreaterThan(15)
  expect(seen((s) => s.lines.some((line) => line.includes("&lt;/canvas-selection&gt;")))).toBeGreaterThan(15)
  expect(
    seen((s) =>
      s.all.some((el) => {
        const kids = shownable(el)
        return kids.some((n, i) => i > 0 && !isElement(n) && !isElement(kids[i - 1]!))
      }),
    ),
  ).toBeGreaterThan(30)
  expect(
    seen((s) => s.all.some((el) => [...el.childNodes].some((n) => n.nodeType === Node.COMMENT_NODE))),
  ).toBeGreaterThan(30)
  expect(seen((s) => texts(s).some((t) => t !== "" && collapse(t) === ""))).toBeGreaterThan(30)
  // Hostile values: clips through a wide character, lengths at the limit,
  // quotes and entities, line breaks, empty values.
  expect(seen((s) => values(s).some(splits(VALUE)))).toBeGreaterThan(15)
  expect(seen((s) => values(s).some((v) => Math.abs(collapse(v).length - VALUE) <= 10))).toBeGreaterThan(15)
  expect(seen((s) => values(s).some((v) => /["<&]/.test(v)))).toBeGreaterThan(30)
  expect(seen((s) => values(s).some((v) => v.includes("\n")))).toBeGreaterThan(30)
  expect(seen((s) => values(s).some((v) => v === ""))).toBeGreaterThan(30)
  // Checkboxes and radios whose state left their attribute, and the opaque
  // elements with something inside.
  expect(seen((s) => s.all.some((el) => isToggle(el) && el.checked !== el.hasAttribute("checked")))).toBeGreaterThan(15)
  for (const tag of OPAQUE) {
    expect(
      seen((s) => s.lines.some((line) => line.includes(`>…</${tag}>`))),
      tag,
    ).toBeGreaterThan(10)
  }
})
