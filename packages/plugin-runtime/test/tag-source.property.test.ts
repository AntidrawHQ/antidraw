import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "@babel/parser"
import fc from "fast-check"
import { expect, test } from "vitest"
import type { Plugin } from "vite"
import { antidraw } from "@antidrawapp/runtime/plugin"

// Random TSX through the source tagger. Each case is a tree of JSX, rendered
// to source while noting where every element's "<" is and where its name
// ends: where its stamp must point, and where it must go. DOM elements take
// a location (data-ad-loc), components a use (data-ad-use), fragments none.

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, "fixture")

const tagSource = () => {
  const plugin = antidraw().find((p) => p.name === "antidraw:tag-source") as Plugin & {
    configResolved: (config: { root: string }) => void
    transform: { handler: (code: string, id: string) => { code: string } | null }
  }
  plugin.configResolved({ root: fixture })
  return (code: string, file: string) => plugin.transform.handler(code, path.join(fixture, file))?.code ?? null
}

type El = {
  kind: "el"
  name: string
  typeArgs: boolean
  attrs: { gap: string; attr: Attr }[]
  end: string
  // null: self-closing.
  children: Child[] | null
}
type Fragment = { kind: "fragment"; children: Child[] }
type Value = El | Fragment
type Attr = { kind: "plain"; code: string } | { kind: "jsx"; value: El }
type Node =
  | { kind: "text"; text: string }
  | { kind: "expr"; code: string }
  | Value
  | { kind: "map"; item: El }
  | { kind: "cond"; a: Value; b: Value | null }
type Child = { gap: string; node: Node }
type Decl = { kind: "const" | "generic-arrow" | "function"; value: Value }

const KEPT = `data-ad-loc="kept"`
const KEPT_USE = `data-ad-use="kept"`

// Lowercase tags, and members ending in one (motion.div), render DOM nodes.
const DOM = ["div", "span", "li", "button", "svg", "path", "motion.div", "ui.icon.arrow"]
const COMPONENTS = ["Card", "UI.Card", "React.Fragment", "motion.Div"]
const isDom = (name: string) => /^[a-z]/.test(name.split(".").pop()!)
const stampOf = (name: string) => (isDom(name) ? "loc" : name === "React.Fragment" ? null : "use")

// Between attributes: spaces, line breaks, and comments holding tags or
// characters Babel ends a line at but editors don't (a lone \r, U+2029).
const attrGap = fc.constantFrom(" ", "\n  ", " /* <b> */ ", " // <i>\n  ", " /* a\rb\u2029c */ ")
const childGap = fc.constantFrom("", " ", "\n    ")
const plainAttr = fc.constantFrom(
  `className="a b"`,
  "{...props}",
  KEPT,
  KEPT_USE,
  "disabled",
  `title={"<b>"}`,
  `style={{ color: "red" }}`,
  "onClick={() => count + 1}",
)
// Text and expressions that look like tags but aren't, wide characters
// ahead of elements on the same line (columns count UTF-16 units), and a
// pasted line separator (U+2028), which doesn't end the line.
const text = fc.record({
  kind: fc.constant("text" as const),
  text: fc.constantFrom("hi", "a &amp; b", "it's", "// not a comment", "🎨 paint", "é", "one\u2028two"),
})
const expr = fc.record({
  kind: fc.constant("expr" as const),
  code: fc.constantFrom(`{"<div>"}`, "{/* <span /> */}", "{count}", "{`<p>${count}</p>`}"),
})

const { value } = fc.letrec<{ el: El; fragment: Fragment; value: Value; node: Node; child: Child }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    text,
    expr,
    tie("el"),
    tie("fragment"),
    fc.record({ kind: fc.constant("map" as const), item: tie("el") }),
    fc.record({ kind: fc.constant("cond" as const), a: tie("value"), b: fc.option(tie("value")) }),
  ),
  child: fc.record({ gap: childGap, node: tie("node") }),
  el: fc
    .record({
      kind: fc.constant("el" as const),
      name: fc.constantFrom(...DOM, ...COMPONENTS),
      typeArgs: fc.boolean(),
      attrs: fc.array(
        fc.record({
          gap: attrGap,
          attr: fc.oneof(
            { depthSize: "small" },
            fc.record({ kind: fc.constant("plain" as const), code: plainAttr }),
            fc.record({ kind: fc.constant("jsx" as const), value: tie("el") }),
          ),
        }),
        { maxLength: 3 },
      ),
      end: fc.constantFrom("", "\n"),
      children: fc.option(fc.array(tie("child"), { maxLength: 3 })),
    })
    // Type arguments where TSX code has them: <motion.div<Props>>.
    .map((e) => ({ ...e, typeArgs: e.typeArgs && e.name.includes(".") })),
  fragment: fc.record({ kind: fc.constant("fragment" as const), children: fc.array(tie("child"), { maxLength: 3 }) }),
  value: fc.oneof({ depthSize: "small" }, tie("el"), tie("fragment")),
}))

type Element = { start: number; nameEnd: number; stamp: "loc" | "use" }

const render = (decls: Decl[], root: Value, eol: string) => {
  let code = ""
  const stamped: Element[] = []
  const emit = (s: string) => {
    code += s.replace(/\n/g, eol)
  }
  const element = (e: El) => {
    const start = code.length
    emit(`<${e.name}`)
    if (e.typeArgs) emit("<{ a: 1 }>")
    const stamp = stampOf(e.name)
    const kept = stamp === "loc" ? KEPT : KEPT_USE
    if (stamp && !e.attrs.some(({ attr }) => attr.kind === "plain" && attr.code === kept)) {
      stamped.push({ start, nameEnd: code.length, stamp })
    }
    for (const { gap, attr } of e.attrs) {
      emit(gap)
      if (attr.kind === "plain") emit(attr.code)
      else {
        emit("icon={")
        element(attr.value)
        emit("}")
      }
    }
    if (!e.children) return emit(`${e.end}/>`)
    emit(`${e.end}>`)
    children(e.children)
    emit(`</${e.name}>`)
  }
  const children = (list: Child[]) =>
    list.forEach(({ gap, node }) => {
      emit(gap)
      at(node)
    })
  const at = (node: Node | null) => {
    if (!node) return emit("null")
    switch (node.kind) {
      case "text":
        return emit(node.text)
      case "expr":
        return emit(node.code)
      case "el":
        return element(node)
      case "fragment":
        emit("<>")
        children(node.children)
        return emit("</>")
      case "map":
        emit("{items.map((item, i) => ")
        element(node.item)
        return emit(")}")
      case "cond":
        emit("{cond ? ")
        at(node.a)
        emit(" : ")
        at(node.b)
        return emit("}")
    }
  }

  emit(`// <div> in a comment\nconst label = "<span>"\n`)
  decls.forEach((decl, i) => {
    if (decl.kind === "const") emit(`const icon${i} = `)
    else if (decl.kind === "generic-arrow") emit(`const Item${i} = <T,>(p: T) => `)
    else emit(`function Part${i}(p: any) {\n  return `)
    at(decl.value)
    emit(decl.kind === "function" ? "\n}\n" : "\n")
  })
  emit("export default function Gen({ items, cond, count, props }: any) {\n  return (\n    ")
  at(root)
  emit("\n  )\n}\n")
  return { code, stamped }
}

const source = fc
  .record({
    file: fc.constantFrom(
      "src/components/user-components/Gen.tsx",
      "src/components/user-components/My Card.tsx",
      "src/components/user-components/Café.tsx",
      "src/lib/Nested.jsx",
    ),
    eol: fc.constantFrom("\n", "\r\n"),
    decls: fc.array(
      fc.record({ kind: fc.constantFrom("const" as const, "generic-arrow" as const, "function" as const), value }),
      { maxLength: 2 },
    ),
    root: value,
  })
  .map(({ file, eol, decls, root }) => ({ file, ...render(decls, root, eol) }))

const STAMP = / data-ad-(loc|use)=\{"((?:[^"\\]|\\.)*)"\}/g

// The line and column of an offset as editors and the agent's Read tool
// count them: lines end only at \n or \r\n (not where Babel also ends them,
// at a lone \r, U+2028 or U+2029), the column in UTF-16 units, both from 1.
const lineColumn = (code: string, offset: number) => {
  const lines = code.slice(0, offset).split(/\r\n|\n/)
  return `${lines.length}:${lines.at(-1)!.length + 1}`
}

test("stamps each element once, after its name, with where its < is, and changes nothing else", () => {
  const transform = tagSource()
  fc.assert(
    fc.property(source, ({ file, code, stamped }) => {
      const out = transform(code, file) ?? code

      // The result still parses.
      parse(out, { sourceType: "module", plugins: ["jsx", "typescript"] })

      // It only adds: without the stamps, it's the source.
      expect(out.replace(STAMP, "")).toBe(code)

      // One per element, a location or a use, and none for fragments: right
      // after its name (and type arguments), naming the line and column of
      // its "<".
      let added = 0
      const stamps = [...out.matchAll(STAMP)].map((m) => {
        const at = m.index - added
        added += m[0].length
        return { at, stamp: m[1], loc: JSON.parse(`"${m[2]}"`) as string }
      })
      expect(stamps).toEqual(
        stamped.map((e) => ({ at: e.nameEnd, stamp: e.stamp, loc: `${file}:${lineColumn(code, e.start)}` })),
      )

      // Run again, it finds nothing left to stamp.
      expect(transform(out, file)).toBeNull()
    }),
    { numRuns: 500 },
  )
})

test("generates the cases that matter", () => {
  // The generator reaches nesting, stamps inside attributes, kept stamps,
  // CRLF files and line separators, or the property above says little.
  const samples = fc.sample(source, { numRuns: 500, seed: 1 })
  const seen = (pred: (s: (typeof samples)[number]) => boolean) => samples.filter(pred).length
  expect(seen((s) => s.stamped.length >= 5)).toBeGreaterThan(25)
  expect(seen((s) => /icon=\{<[a-z]/.test(s.code))).toBeGreaterThan(25)
  expect(seen((s) => s.code.includes(KEPT))).toBeGreaterThan(25)
  expect(seen((s) => s.code.includes(KEPT_USE))).toBeGreaterThan(25)
  expect(seen((s) => s.stamped.some((e) => e.stamp === "use"))).toBeGreaterThan(25)
  expect(seen((s) => s.code.includes("<React.Fragment"))).toBeGreaterThan(25)
  expect(seen((s) => s.code.includes("\r\n"))).toBeGreaterThan(25)
  expect(seen((s) => /[\u2028\u2029]|\r(?!\n)/.test(s.code))).toBeGreaterThan(25)
  expect(seen((s) => /<[a-z.]+<\{ a: 1 \}>/.test(s.code))).toBeGreaterThan(25)
})
