// @vitest-environment jsdom
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { format } from "node:util"
import fc from "fast-check"
import type { ComponentType } from "react"
import type { Plugin } from "vite"
import { afterAll, beforeAll, expect, test, vi } from "vitest"

// Tagged code, run. The tagger stamps each element where it's written: a DOM
// element with its location (data-ad-loc), a component with its use
// (data-ad-use), which is just another prop. Put right after the name, a
// caller's {...props} written later replaces it, so a component that passes
// its props on hands its DOM node the outermost use that got through. Here
// random workspaces of a few modules go through the real tagger, compile as
// the dev server compiles JSX, and render with React in jsdom. A small
// interpreter of the same generated code says what every DOM node must
// carry, and the DOM must carry exactly that.

const here = path.dirname(fileURLToPath(import.meta.url))
// Where the generated workspace is said to be. Nothing is written there: the
// tagger only needs files under a root to name them from it.
const workspaceRoot = path.join(here, "tag-use")

// esbuild wants TextEncoder's bytes to be the global Uint8Array, as it loads
// and as it talks to its service, and under jsdom the global one is the
// window's. Node's stands in while this file runs (React and jsdom don't mind),
// and Vite, the plugin and plugin-react, which load esbuild, load after.
const jsdomUint8Array = globalThis.Uint8Array
globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor
afterAll(() => {
  globalThis.Uint8Array = jsdomUint8Array
})
const [{ createServer, transformWithEsbuild }, { default: react }, { antidraw }] = await Promise.all([
  import("vite"),
  import("@vitejs/plugin-react"),
  import("@antidrawapp/runtime/plugin"),
])

const tagSource = (root: string) => {
  const plugin = antidraw().find((p) => p.name === "antidraw:tag-source") as Plugin & {
    configResolved: (config: { root: string }) => void
    transform: { handler: (code: string, id: string) => { code: string } | null }
  }
  plugin.configResolved({ root })
  return (code: string, file: string) => plugin.transform.handler(code, path.join(root, file))?.code ?? null
}

// React from Node's own require, the one the compiled modules get, so the
// renderer and the elements share one copy.
const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire("react") as typeof import("react")
const { createRoot } = nodeRequire("react-dom/client") as typeof import("react-dom/client")
const EXTERNAL = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"])

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

// The workspace's modules. Gen, the previewed component, is in the first;
// the others are shared, as shadcn's are. A module only imports from the
// ones after it, so there are no cycles.
const MODULES = [
  { file: "src/components/user-components/Gen.tsx", spec: "@/components/user-components/Gen", ns: "" },
  { file: "src/components/ui/button.tsx", spec: "@/components/ui/button", ns: "ButtonKit" },
  { file: "src/components/ui/slot.tsx", spec: "@/components/ui/slot", ns: "SlotKit" },
]

// The generated code, as an AST the source and the model are both made from.
type Decl = "function" | "arrow" | "memo" | "forwardRef" | "memo-forwardRef" | "class" | "member"
// How props are taken: whole (props), destructured with the rest in the
// signature ({ children, ...rest }), in the body (const { className, ...rest }
// = props), or only some keys picked ({ children, title }).
type Style = "whole" | "sig" | "body" | "picked"
// const Comp = "button", asLink ? "a" : "button", or asChild ? Slot : "button".
type CompVar = "button" | "asLink" | "asChild"
type SlotMerge = "child-wins" | "slot-wins"
type Source = "props" | "rest"
type Builtin = "Suspense" | "StrictMode" | "Profiler" | "Ctx" | "Ctx.Provider"
type FragmentName = "Fragment" | "React.Fragment" | "F"
type Tag =
  | { kind: "dom"; name: string }
  | { kind: "comp"; index: number; ref: string }
  | { kind: "var" }
  | { kind: "builtin"; name: Builtin }
  | { kind: "fragment"; name: FragmentName }
type Attr =
  | { kind: "spread"; source: Source }
  | { kind: "class" }
  | { kind: "title" }
  | { kind: "asChild" }
  | { kind: "kept"; stamp: "loc" | "use" }
  | { kind: "asLink"; value: boolean }
  | { kind: "icon" | "render"; el: El }
type El = { tag: Tag; typeArgs: boolean; key: string | null; attrs: Attr[]; children: Node[] | null }
type Node =
  | { kind: "text" | "number" | "children" | "icon" | "render" | "null" | "string" }
  | { kind: "el" | "portal"; el: El }
  | { kind: "frag"; children: Node[] }
  | { kind: "map"; items: number; index: string; el: El }
  | { kind: "cond"; on: boolean; a: Node; b: Node }
  | { kind: "and"; on: boolean; a: Node }
  | { kind: "array"; els: El[] }
type Comp = {
  // -1 for Gen.
  index: number
  module: number
  decl: Decl | "default"
  generic: boolean
  style: Style
  keys: string[]
  sources: Source[]
  compVar: CompVar | null
  slotTarget: number | null
  slot: SlotMerge | null
  body: Node
}
type Workspace = { comps: Comp[]; gen: Comp }

// What's generated first: the same shapes with every choice that depends on
// where it lands (which components are in scope, what can be spread) left
// as a number, settled by header() and resolveEl() below. Shrinking stays
// simple that way.
type RawTag = "dom" | "comp" | "builtin" | "fragment" | "var"
type PlainAttr = "spread" | "class" | "title" | "kept-loc" | "kept-use" | "asLink" | "asChild"
// asChild: used asChild, if what it calls is a button that can be.
type RawEl = { tag: RawTag; pick: number; via: boolean; typeArgs: boolean; asChild: boolean; attrs: RawAttr[]; children: RawNode[] | null }
type RawAttr = { kind: PlainAttr; pick: number } | { kind: "icon" | "render"; el: RawEl }
type RawNode =
  | { kind: "text" | "number" | "children" | "icon" | "render" }
  | { kind: "el" | "portal"; el: RawEl }
  | { kind: "frag"; children: RawNode[] }
  | { kind: "map"; items: number; el: RawEl }
  | { kind: "cond"; on: boolean; a: RawNode; b: RawNode }
  | { kind: "and"; on: boolean; a: RawNode }
type RawBody = { kind: "node"; node: RawNode } | { kind: "null" | "string" } | { kind: "array"; els: RawEl[] }
type RawComp = {
  decl: Decl
  generic: boolean
  style: Style
  children: boolean
  extras: string[]
  compVar: CompVar | "none"
  slot: SlotMerge | "none"
  level: number
  pick: number
  rootAttrs: RawAttr[]
  body: RawBody
}

const { el: rawEl, attr: rawAttr, node: rawNode } = fc.letrec<{ el: RawEl; attr: RawAttr; node: RawNode }>((tie) => ({
  el: fc.record({
    tag: fc.constantFrom<RawTag>("dom", "dom", "dom", "comp", "comp", "comp", "builtin", "builtin", "fragment", "fragment", "var"),
    pick: fc.nat(),
    via: fc.boolean(),
    typeArgs: fc.boolean(),
    asChild: fc.boolean(),
    attrs: fc.array(tie("attr"), { maxLength: 3 }),
    children: fc.option(fc.array(tie("node"), { maxLength: 3 }), { nil: null }),
  }),
  attr: fc.oneof(
    { depthSize: "small" },
    { weight: 6, arbitrary: fc.record({ kind: fc.constantFrom<PlainAttr>("spread", "spread", "spread", "class", "title", "kept-loc", "kept-use", "asLink", "asChild", "asChild"), pick: fc.nat() }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constantFrom("icon" as const, "render" as const), el: tie("el") }) },
  ),
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    { weight: 3, arbitrary: fc.record({ kind: fc.constantFrom("text" as const, "number" as const, "children" as const, "children" as const, "icon" as const, "render" as const) }) },
    { weight: 6, arbitrary: fc.record({ kind: fc.constant("el" as const), el: tie("el") }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("portal" as const), el: tie("el") }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("frag" as const), children: fc.array(tie("node"), { maxLength: 3 }) }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant("map" as const), items: fc.nat(), el: tie("el") }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("cond" as const), on: fc.boolean(), a: tie("node"), b: tie("node") }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("and" as const), on: fc.boolean(), a: tie("node") }) },
  ),
}))

// The element a component returns: mostly a DOM element or another
// component, given what it was given ({...props}, {children}), as the
// components worth inspecting are.
const spreadAttr = fc.record({ kind: fc.constant<PlainAttr>("spread"), pick: fc.nat() })
const rootEl = (tags: RawTag[], children: fc.Arbitrary<RawNode[] | null>) =>
  fc.record({
    tag: fc.constantFrom(...tags),
    pick: fc.nat(),
    via: fc.boolean(),
    typeArgs: fc.boolean(),
    asChild: fc.boolean(),
    attrs: fc.array(fc.oneof({ weight: 1, arbitrary: spreadAttr }, { weight: 1, arbitrary: rawAttr }), { maxLength: 3 }),
    children,
  })
const passedOn = fc.oneof(
  { weight: 1, arbitrary: fc.constant<RawNode>({ kind: "children" }) },
  { weight: 2, arbitrary: rawNode },
)
const asNode = (el: RawEl): RawNode => ({ kind: "el", el })

const rawBody: fc.Arbitrary<RawBody> = fc.oneof(
  {
    weight: 7,
    arbitrary: fc.record({
      kind: fc.constant("node" as const),
      node: rootEl(["dom", "dom", "dom", "comp", "comp", "var"], fc.option(fc.array(passedOn, { maxLength: 3 }), { nil: null, freq: 3 })).map(asNode),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("node" as const), node: rawNode }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constantFrom("null" as const, "string" as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("array" as const), els: fc.array(rawEl, { minLength: 1, maxLength: 2 }) }) },
)

// Gen, the previewed component: a <div> of a few things, mostly uses of the
// other components, with children of their own.
const use = rootEl(["comp", "comp", "comp", "dom"], fc.option(fc.array(rawNode, { maxLength: 3 }), { nil: null, freq: 2 }))
const genBody: fc.Arbitrary<RawBody> = rootEl(
  ["dom"],
  fc.array(fc.oneof({ weight: 3, arbitrary: use.map(asNode) }, { weight: 1, arbitrary: rawNode }), { minLength: 1, maxLength: 4 }),
).map((el) => ({ kind: "node", node: asNode({ ...el, pick: 0 }) }))

const rawComp = (body: fc.Arbitrary<RawBody>): fc.Arbitrary<RawComp> =>
  fc.record({
    decl: fc.constantFrom<Decl>("function", "arrow", "memo", "forwardRef", "memo-forwardRef", "class", "member"),
    generic: fc.boolean(),
    style: fc.constantFrom<Style>("whole", "sig", "sig", "body", "picked"),
    children: fc.boolean(),
    extras: fc.subarray(["title", "icon", "render", "asLink", "asChild"]),
    compVar: fc.constantFrom<CompVar | "none">("none", "none", "button", "asLink", "asChild", "asChild", "asChild", "asChild"),
    slot: fc.constantFrom<SlotMerge | "none">("none", "none", "none", "child-wins", "slot-wins"),
    level: fc.nat({ max: 2 }),
    pick: fc.nat(),
    rootAttrs: fc.array(fc.record({ kind: fc.constantFrom<PlainAttr>("class", "title", "kept-loc", "kept-use"), pick: fc.nat() }), { maxLength: 2 }),
    body,
  })

// Lowercase tags render DOM nodes (a custom element too); a, button and
// input each have their rules, svg its namespace.
const DOM_PICKS = ["div", "div", "span", "span", "button", "a", "input", "svg", "my-el"]
const BUILTINS: Builtin[] = ["Suspense", "StrictMode", "Profiler", "Ctx", "Ctx.Provider"]
// F is `Fragment as F`: not literally named Fragment, so the tagger takes it
// for a component.
const FRAGMENTS: FragmentName[] = ["Fragment", "React.Fragment", "F"]
// Props a component must take out before its props reach the DOM.
const SPECIAL = ["icon", "render", "asLink", "asChild"]
const SPAN: RawEl = { tag: "dom", pick: 2, via: false, typeArgs: false, asChild: false, attrs: [], children: null }

const header = (r: RawComp, index: number, module: number, callable: number[], comps: Comp[]): Comp => {
  const decl = index === -1 ? "default" : r.decl
  const slot = index === -1 || r.slot === "none" ? null : r.slot
  // A Slot takes ({ children, ...slotProps }) and clones its one child.
  if (slot) {
    return { index, module, decl, generic: false, style: "sig", keys: ["children"], sources: [], compVar: null, slotTarget: null, slot, body: { kind: "null" } }
  }
  const style = r.style
  const keys =
    style === "whole"
      ? []
      : style === "sig"
        ? [...(r.children ? ["children"] : []), ...r.extras]
        : style === "body"
          ? ["className", ...r.extras]
          : ["children", ...r.extras.filter((k) => k !== "asChild")]
  // Gen is no button: nothing would use it asChild.
  let compVar: CompVar | null = r.compVar === "none" ? null : index === -1 && r.compVar === "asChild" ? "button" : r.compVar
  let slotTarget: number | null = null
  if (compVar === "asLink" && style === "whole") compVar = "button"
  if (compVar === "asChild") {
    // shadcn's button: <Comp {...props} />, where Comp is a Slot when asChild.
    const slots = callable.filter((j) => comps[j]!.slot)
    if ((style === "sig" || style === "body") && slots.length) slotTarget = slots[r.pick % slots.length]!
    else compVar = "button"
  }
  if (compVar === "asLink" && !keys.includes("asLink")) keys.push("asLink")
  if (compVar === "asChild") {
    // Its children go on in the rest, to the Slot.
    if (!keys.includes("asChild")) keys.push("asChild")
    if (keys.includes("children")) keys.splice(keys.indexOf("children"), 1)
  }
  // Spreading what it was given passes on what it was given: a component that
  // takes out icon or asLink spreads only the rest.
  const sources: Source[] =
    style === "whole" ? ["props"] : style === "sig" ? ["rest"] : style === "body" ? (keys.some((k) => SPECIAL.includes(k)) ? ["rest"] : ["rest", "props"]) : []
  const generic = r.generic && (decl === "function" || decl === "arrow")
  return { index, module, decl, generic, style, keys, sources, compVar, slotTarget, slot, body: { kind: "null" } }
}

type Cx = { comps: Comp[]; self: Comp; callable: number[]; depth: number }

const refTo = (callee: Comp, from: number, via: boolean) => {
  const base = callee.decl === "member" ? `kit${callee.index}.box` : `C${callee.index}`
  return callee.module === from || !via ? base : `${MODULES[callee.module]!.ns}.${base}`
}

const resolveAttrs = (raw: RawAttr[], sources: Source[], cx: Cx, callee: Comp | null): Attr[] => {
  const seen = new Set<string>()
  return raw.flatMap((a): Attr[] => {
    switch (a.kind) {
      case "spread":
        return sources.length ? [{ kind: "spread", source: sources[a.pick % sources.length]! }] : []
      case "class":
      case "title":
        return [{ kind: a.kind }]
      case "kept-loc":
        return [{ kind: "kept", stamp: "loc" }]
      case "kept-use":
        return [{ kind: "kept", stamp: "use" }]
    }
    // The rest only go to a component that takes them out, once each.
    if (!callee?.keys.includes(a.kind) || seen.has(a.kind)) return []
    seen.add(a.kind)
    if (a.kind === "asLink") return [{ kind: "asLink", value: a.pick % 2 === 0 }]
    if (a.kind === "asChild") return [{ kind: "asChild" }]
    return a.kind === "icon" || a.kind === "render" ? [{ kind: a.kind, el: resolveEl(a.el, cx) }] : []
  })
}

const resolveEl = (r: RawEl, cx: Cx, opts: { element?: boolean; key?: string } = {}): El => {
  let kind = r.tag
  // A list's items may be keyed fragments, <React.Fragment key={i}>.
  if (opts.element && kind === "fragment" && opts.key) {
    return { tag: { kind: "fragment", name: "React.Fragment" }, typeArgs: false, key: opts.key, attrs: [], children: r.children?.map((n) => resolveNode(n, cx)) ?? null }
  }
  if (opts.element && kind !== "dom" && kind !== "comp") kind = "comp"
  if (kind === "comp" && !cx.callable.length) kind = "dom"
  if (kind === "var" && (cx.self.compVar === null || cx.self.compVar === "asChild")) kind = "dom"
  const key = opts.key ?? null
  const children = () => r.children?.map((n) => resolveNode(n, cx)) ?? null
  // void and leaf elements only take spreads that can't carry children.
  const childless = cx.self.keys.includes("children") ? cx.self.sources.filter((s) => s === "rest") : []
  if (kind === "dom") {
    const name = DOM_PICKS[r.pick % DOM_PICKS.length]!
    if (name === "input") return { tag: { kind: "dom", name }, typeArgs: false, key, attrs: resolveAttrs(r.attrs, childless, cx, null), children: null }
    if (name === "svg") {
      const first = r.children?.find((n) => n.kind === "el")
      const pathEl: El = {
        tag: { kind: "dom", name: "path" },
        typeArgs: false,
        key: null,
        attrs: resolveAttrs(first?.kind === "el" ? first.el.attrs : [], childless, cx, null),
        children: null,
      }
      return { tag: { kind: "dom", name }, typeArgs: false, key, attrs: resolveAttrs(r.attrs, cx.self.sources, cx, null), children: [{ kind: "el", el: pathEl }] }
    }
    return { tag: { kind: "dom", name }, typeArgs: false, key, attrs: resolveAttrs(r.attrs, cx.self.sources, cx, null), children: children() }
  }
  if (kind === "comp") {
    const index = cx.callable[r.pick % cx.callable.length]!
    const callee = cx.comps[index]!
    const attrs = resolveAttrs(r.attrs, cx.self.sources, cx, callee)
    if (r.asChild && callee.compVar === "asChild" && !attrs.some((a) => a.kind === "asChild")) attrs.push({ kind: "asChild" })
    // A Slot, or a button asChild, clones its one child.
    const one = callee.slot || attrs.some((a) => a.kind === "asChild")
    const first = r.children?.find((n) => n.kind === "el")
    return {
      tag: { kind: "comp", index, ref: refTo(callee, cx.self.module, r.via) },
      typeArgs: r.typeArgs && (callee.generic || callee.decl === "member"),
      key,
      attrs,
      children: one ? [{ kind: "el", el: resolveEl(first?.kind === "el" ? first.el : SPAN, cx, { element: true }) }] : children(),
    }
  }
  if (kind === "var") return { tag: { kind: "var" }, typeArgs: false, key, attrs: resolveAttrs(r.attrs, cx.self.sources, cx, null), children: children() }
  if (kind === "builtin") return { tag: { kind: "builtin", name: BUILTINS[r.pick % BUILTINS.length]! }, typeArgs: false, key, attrs: [], children: children() }
  return { tag: { kind: "fragment", name: FRAGMENTS[r.pick % FRAGMENTS.length]! }, typeArgs: false, key, attrs: [], children: children() }
}

const resolveNode = (n: RawNode, cx: Cx): Node => {
  switch (n.kind) {
    case "text":
    case "number":
    case "children":
      return { kind: n.kind }
    case "icon":
    case "render":
      return cx.self.keys.includes(n.kind) ? { kind: n.kind } : { kind: "text" }
    case "el":
    case "portal":
      return { kind: n.kind, el: resolveEl(n.el, cx) }
    case "frag":
      return { kind: "frag", children: n.children.map((c) => resolveNode(c, cx)) }
    case "map": {
      const index = "ijk"[cx.depth]!
      return { kind: "map", items: 1 + (n.items % 3), index, el: resolveEl(n.el, { ...cx, depth: cx.depth + 1 }, { element: true, key: `{${index}}` }) }
    }
    case "cond":
      return { kind: "cond", on: n.on, a: resolveNode(n.a, cx), b: resolveNode(n.b, cx) }
    case "and":
      return { kind: "and", on: n.on, a: resolveNode(n.a, cx) }
  }
}

const resolveBody = (r: RawComp, c: Comp, cx: Cx): Node => {
  if (c.compVar === "asChild") {
    // <Comp className="x" {...rest} />, the spread anywhere among the rest.
    const attrs = resolveAttrs(r.rootAttrs, [], cx, null)
    attrs.splice(r.pick % (attrs.length + 1), 0, { kind: "spread", source: "rest" })
    return { kind: "el", el: { tag: { kind: "var" }, typeArgs: false, key: null, attrs, children: null } }
  }
  const b = r.body
  if (b.kind === "node") return resolveNode(b.node, cx)
  if (b.kind === "array") return { kind: "array", els: b.els.map((e, i) => resolveEl(e, cx, { element: true, key: `"${"ab"[i]}"` })) }
  return { kind: b.kind }
}

const workspace: fc.Arbitrary<Workspace> = fc
  .record({ comps: fc.array(rawComp(rawBody), { minLength: 1, maxLength: 5 }), gen: rawComp(genBody) })
  .map(({ comps: raw, gen: rawGen }) => {
    // Module levels in order: a component only calls ones after it, so it
    // only imports from its own module or one further down.
    const levels = raw.map((r) => r.level).sort((a, b) => a - b)
    const comps: Comp[] = []
    for (let i = raw.length - 1; i >= 0; i--) {
      const callable = raw.map((_, j) => j).filter((j) => j > i)
      comps[i] = header(raw[i]!, i, levels[i]!, callable, comps)
    }
    const all = raw.map((_, j) => j)
    const gen = header(rawGen, -1, 0, all, comps)
    raw.forEach((r, i) => {
      const c = comps[i]!
      if (!c.slot) c.body = resolveBody(r, c, { comps, self: c, callable: all.filter((j) => j > i), depth: 0 })
    })
    gen.body = resolveBody(rawGen, gen, { comps, self: gen, callable: all, depth: 0 })
    return { comps, gen }
  })

const tagName = (t: Tag) =>
  t.kind === "dom" ? t.name : t.kind === "comp" ? t.ref : t.kind === "var" ? "Comp" : t.name
// What the tagger stamps a name with.
const stampOf = (name: string) => {
  const last = name.split(".").pop()!
  return /^[a-z]/.test(last) ? "loc" : last === "Fragment" ? null : "use"
}
const BUILTIN_PROPS: Record<Builtin, string> = {
  Suspense: "",
  StrictMode: "",
  Profiler: ` id="p" onRender={() => {}}`,
  Ctx: " value={1}",
  "Ctx.Provider": " value={1}",
}

// The source of each module, and where each element's "<" is.
const emit = (w: Workspace) => {
  const locs = new Map<El, string>()
  const files: Record<string, string> = {}
  const used = MODULES.map((_, m) => m === 0 || w.comps.some((c) => c.module === m))
  MODULES.forEach((mod, m) => {
    if (!used[m]) return
    let code = ""
    const starts: [El, number][] = []
    const out = (s: string) => {
      code += s
    }
    let self: Comp = w.gen
    const spreadOf = (source: Source) => (source === "props" && self.style === "whole" && self.decl === "class" ? "this.props" : source)
    const childrenOf = (c: Comp) =>
      c.style === "whole"
        ? c.decl === "class"
          ? "this.props.children"
          : "props.children"
        : c.style === "sig"
          ? c.keys.includes("children")
            ? "children"
            : "rest.children"
          : c.style === "body"
            ? "props.children"
            : "children"
    const el = (e: El) => {
      starts.push([e, code.length])
      const name = tagName(e.tag)
      out(`<${name}`)
      if (e.typeArgs) out("<{ a: 1 }>")
      if (e.key) out(` key=${e.key}`)
      if (e.tag.kind === "builtin") out(BUILTIN_PROPS[e.tag.name])
      if (e.tag.kind === "dom" && e.tag.name === "path") out(` d="M0 0h1"`)
      for (const a of e.attrs) {
        out(" ")
        if (a.kind === "spread") out(`{...${spreadOf(a.source)}}`)
        else if (a.kind === "class") out(`className="x"`)
        else if (a.kind === "title") out(`title="t"`)
        else if (a.kind === "asChild") out("asChild")
        else if (a.kind === "kept") out(`data-ad-${a.stamp}="kept"`)
        else if (a.kind === "asLink") out(a.value ? "asLink" : "asLink={false}")
        else {
          out(a.kind === "icon" ? "icon={" : "render={() => ")
          el(a.el)
          out("}")
        }
      }
      if (!e.children) return out(" />")
      out(">")
      e.children.forEach(child)
      out(`</${name}>`)
    }
    const child = (n: Node) => {
      if (n.kind === "text") return out("hi")
      if (n.kind === "el") return el(n.el)
      if (n.kind === "frag") {
        out("<>")
        n.children.forEach(child)
        return out("</>")
      }
      out("{")
      expr(n)
      out("}")
    }
    const expr = (n: Node): void => {
      switch (n.kind) {
        case "text":
          return out(`"hi"`)
        case "number":
          return out("7")
        case "null":
          return out("null")
        case "string":
          return out(`"text"`)
        case "children":
          return out(childrenOf(self))
        case "icon":
          return out("icon")
        case "render":
          return out("render?.()")
        case "el":
          return el(n.el)
        case "frag":
          out("<>")
          n.children.forEach(child)
          return out("</>")
        case "portal":
          out("createPortal(")
          el(n.el)
          return out(`, document.getElementById("portal")!)`)
        case "map":
          out(`[${Array.from({ length: n.items }, (_, k) => k + 1).join(", ")}].map((${n.index}) => `)
          el(n.el)
          return out(")")
        case "cond":
          out(`(${n.on ? "on" : "off"} ? `)
          expr(n.a)
          out(" : ")
          expr(n.b)
          return out(")")
        case "and":
          out(`(${n.on ? "on" : "off"} && `)
          expr(n.a)
          return out(")")
        case "array":
          out("[")
          n.els.forEach((e, i) => {
            if (i) out(", ")
            el(e)
          })
          return out("]")
      }
    }
    const destructure = (c: Comp) => `{ ${[...c.keys, ...(c.style === "picked" ? [] : ["...rest"])].join(", ")} }`
    const component = (c: Comp) => {
      self = c
      const name = c.decl === "member" ? `kit${c.index}` : `C${c.index}`
      const params = c.slot ? "{ children, ...slotProps }: any" : c.style === "whole" || c.style === "body" ? "props: any" : `${destructure(c)}: any`
      const prelude: string[] = []
      if (c.decl === "class") {
        if (c.slot) prelude.push("const { children, ...slotProps } = this.props")
        else if (c.style === "body") prelude.push("const props = this.props")
        else if (c.style !== "whole") prelude.push(`const ${destructure(c)} = this.props`)
      }
      if (!c.slot && c.style === "body") prelude.push(`const ${destructure(c)} = props`)
      if (c.compVar === "button") prelude.push(`const Comp = "button"`)
      if (c.compVar === "asLink") prelude.push(`const Comp = asLink ? "a" : "button"`)
      if (c.compVar === "asChild") prelude.push(`const Comp = asChild ? ${refTo(w.comps[c.slotTarget!]!, c.module, false)} : "button"`)
      const inner = () => {
        for (const line of prelude) out(`    ${line}\n`)
        out("    return (")
        if (c.slot === "child-wins") out("isValidElement(children) ? cloneElement(children, { ...slotProps, ...(children.props as object) }) : null")
        else if (c.slot === "slot-wins") out("isValidElement(children) ? cloneElement(children, { ...(children.props as object), ...slotProps }) : null")
        else expr(c.body)
        out(")\n")
      }
      if (c.decl === "default") {
        out(`export default function Gen(${params}) {\n`)
        inner()
        out("}\n")
      } else if (c.decl === "function") {
        out(`export function ${name}${c.generic ? "<T>" : ""}(${params}) {\n`)
        inner()
        out("}\n")
      } else if (c.decl === "arrow") {
        out(`export const ${name} = ${c.generic ? "<T,>" : ""}(${params}) => {\n`)
        inner()
        out("}\n")
      } else if (c.decl === "memo") {
        out(`export const ${name} = memo(function ${name}(${params}) {\n`)
        inner()
        out("})\n")
      } else if (c.decl === "forwardRef") {
        out(`export const ${name} = forwardRef((${params}, ref: any) => {\n`)
        inner()
        out("})\n")
      } else if (c.decl === "memo-forwardRef") {
        out(`export const ${name} = memo(forwardRef((${params}, ref: any) => {\n`)
        inner()
        out("}))\n")
      } else if (c.decl === "class") {
        out(`export class ${name} extends Component<any> {\n  render() {\n`)
        inner()
        out("  }\n}\n")
      } else {
        out(`export const ${name} = {\n  box: (${params}) => {\n`)
        inner()
        out("  },\n}\n")
      }
    }

    out(
      `import React, { Component, Fragment, Fragment as F, Profiler, StrictMode, Suspense, cloneElement, createContext, forwardRef, isValidElement, memo } from "react"\n` +
        `import { createPortal } from "react-dom"\n`,
    )
    MODULES.forEach((lower, k) => {
      if (k <= m || !used[k]) return
      const names = w.comps.filter((c) => c.module === k).map((c) => (c.decl === "member" ? `kit${c.index}` : `C${c.index}`))
      out(`import * as ${lower.ns} from "${lower.spec}"\nimport { ${names.join(", ")} } from "${lower.spec}"\n`)
    })
    out("const Ctx = createContext(0)\nconst on: boolean = true\nconst off: boolean = false\n\n")
    w.comps.filter((c) => c.module === m).forEach(component)
    if (m === 0) component(w.gen)
    files[mod.file] = code
    const lineStarts = [0]
    for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) lineStarts.push(i + 1)
    for (const [e, offset] of starts) {
      let line = 0
      while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= offset) line++
      locs.set(e, `${mod.file}:${line + 1}:${offset - lineStarts[line]! + 1}`)
    }
  })
  return { files, locs }
}

// The model: a little React over the same AST. An element's props start as
// its stamp (unless one is written), then each written attribute and spread
// in order, later winning; a component decides where they go.
type Stamps = { tag: string; loc: string | null; use: string | null }
type ElType = { kind: "dom"; tag: string } | { kind: "comp"; comp: Comp } | { kind: "pass" } | { kind: "portal" }
type ElVal = { el: true; type: ElType; own: string | null; props: Record<string, unknown> }
const isEl = (v: unknown): v is ElVal => !!v && typeof v === "object" && (v as ElVal).el === true

const model = (w: Workspace, locs: Map<El, string>) => {
  const facts = new Set<string>()
  type Env = { bindings: Record<string, unknown>; compTag: ElType | null }
  const evalEl = (e: El, env: Env): ElVal => {
    const own = locs.get(e)!
    const stamp = stampOf(tagName(e.tag))
    const props: Record<string, unknown> = {}
    if (stamp && !e.attrs.some((a) => a.kind === "kept" && a.stamp === stamp)) props[`data-ad-${stamp}`] = own
    for (const a of e.attrs) {
      if (a.kind === "spread") Object.assign(props, env.bindings[a.source])
      else if (a.kind === "class") props.className = "x"
      else if (a.kind === "title") props.title = "t"
      else if (a.kind === "asChild") props.asChild = true
      else if (a.kind === "kept") props[`data-ad-${a.stamp}`] = "kept"
      else if (a.kind === "asLink") props.asLink = a.value
      else props[a.kind] = evalEl(a.el, env)
    }
    if (e.children?.length) {
      const values = e.children.map((n) => evalNode(n, env))
      props.children = values.length === 1 ? values[0] : values
    }
    const t = e.tag
    const type: ElType =
      t.kind === "dom" ? { kind: "dom", tag: t.name } : t.kind === "comp" ? { kind: "comp", comp: w.comps[t.index]! } : t.kind === "var" ? env.compTag! : { kind: "pass" }
    return { el: true, type, own, props }
  }
  const evalNode = (n: Node, env: Env): unknown => {
    switch (n.kind) {
      case "text":
        return "hi"
      case "number":
        return 7
      case "null":
        return null
      case "string":
        return "text"
      case "children":
      case "icon":
      case "render":
        return env.bindings[n.kind]
      case "el":
        return evalEl(n.el, env)
      case "frag": {
        const values = n.children.map((c) => evalNode(c, env))
        return { el: true, type: { kind: "pass" }, own: null, props: values.length ? { children: values.length === 1 ? values[0] : values } : {} }
      }
      case "portal":
        return { el: true, type: { kind: "portal" }, own: null, props: { children: evalEl(n.el, env) } }
      case "map":
        return Array.from({ length: n.items }, () => evalEl(n.el, env))
      case "cond":
        return evalNode(n.on ? n.a : n.b, env)
      case "and":
        return n.on ? evalNode(n.a, env) : false
      case "array":
        return n.els.map((e) => evalEl(e, env))
    }
  }
  const invoke = (c: Comp, props: Record<string, unknown>): unknown => {
    if (c.slot) {
      // cloneElement(children, merged): the child's props, then merged's.
      const { children, ...slotProps } = props
      if (!isEl(children) || children.type.kind === "pass" || children.type.kind === "portal") throw new Error("a Slot's child must be one element")
      facts.add(`rendered: ${c.slot} onto ${children.type.kind}`)
      const merged = c.slot === "child-wins" ? { ...slotProps, ...children.props } : { ...children.props, ...slotProps }
      return { ...children, props: { ...children.props, ...merged } }
    }
    const bindings: Record<string, unknown> = { props, children: props.children }
    for (const k of c.keys) bindings[k] = props[k]
    bindings.rest = Object.fromEntries(Object.entries(props).filter(([k]) => !c.keys.includes(k)))
    const button: ElType = { kind: "dom", tag: "button" }
    const compTag: ElType | null =
      c.compVar === "button"
        ? button
        : c.compVar === "asLink"
          ? props.asLink
            ? { kind: "dom", tag: "a" }
            : button
          : c.compVar === "asChild"
            ? props.asChild
              ? (facts.add("rendered: asChild"), { kind: "comp", comp: w.comps[c.slotTarget!]! })
              : button
            : null
    return evalNode(c.body, { bindings, compTag })
  }
  const dom: Stamps[] = []
  const portal: Stamps[] = []
  let nested = false
  // A component that renders its children twice, used in one that does too,
  // doubles each time: cases past a few hundred elements are left out.
  let big = false
  const str = (v: unknown) => (v === undefined ? null : (v as string))
  // calls: where each component on the way here was used, outermost first.
  const render = (v: unknown, out: Stamps[], ancestors: string[], calls: string[]): void => {
    if (Array.isArray(v)) return v.forEach((x) => render(x, out, ancestors, calls))
    if (!isEl(v) || big) return
    const { type, props } = v
    if (type.kind === "pass") return render(props.children, out, ancestors, calls)
    if (type.kind === "portal") return render(props.children, portal, [], calls)
    if (type.kind === "comp") return render(invoke(type.comp, props), out, ancestors, [...calls, v.own!])
    const s = { tag: type.tag, loc: str(props["data-ad-loc"]), use: str(props["data-ad-use"]) }
    out.push(s)
    if (dom.length + portal.length > 400) big = true
    // <a> in <a> and <button> in <button> are invalid HTML, which React
    // warns about: such cases are left out.
    if ((s.tag === "a" || s.tag === "button") && ancestors.includes(s.tag)) nested = true
    if (s.tag === "input" && props.children != null) throw new Error("children reached an <input>")
    const file = (stamp: string | null) => stamp?.replace(/:\d+:\d+$/, "")
    if (s.use && s.use !== "kept" && s.loc && s.loc !== "kept" && file(s.use) !== file(s.loc)) facts.add("dom: use from another file")
    if (s.use && s.use !== "kept" && !s.loc) facts.add("dom: use, no loc")
    if (s.loc && s.loc !== "kept" && s.loc !== v.own) facts.add("dom: loc from a call site")
    if (s.use && calls.length - calls.lastIndexOf(s.use) >= 2 && calls.includes(s.use)) facts.add("dom: use passed through 2+ components")
    render(props.children, out, [...ancestors, s.tag], calls)
  }
  render(invoke(w.gen, {}), dom, [], [])
  return { expected: { root: dom, portal }, skip: nested || big, facts }
}

const build = (w: Workspace) => {
  const { files, locs } = emit(w)
  const { expected, skip, facts } = model(w, locs)
  return { files, expected, skip, facts }
}

// The cases: the workspace's files and the stamps its DOM must carry.
const cases = workspace
  .map(build)
  .filter((b) => !b.skip)
  .map(({ files, expected }) => ({ files, expected }))

// As the dev server compiles JSX: the tagger on the file as written, then
// esbuild's automatic runtime in development (jsxDEV). Modules are linked by
// a small require that hands out Node's own React.
const load = async (files: Record<string, string>, root: string) => {
  const tag = tagSource(root)
  const compiled: Record<string, string> = {}
  for (const [file, code] of Object.entries(files)) {
    const tagged = tag(code, file) ?? code
    const result = await transformWithEsbuild(tagged, path.join(root, file), { jsx: "automatic", jsxDev: true, format: "cjs", sourcemap: false })
    compiled[file] = result.code
  }
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const require = (id: string, from = ""): unknown => {
    if (EXTERNAL.has(id)) return nodeRequire(id)
    // "@/…" is src/, as the workspace's alias has it.
    const file = id.startsWith("@/") ? `src/${id.slice(2)}.tsx` : id.startsWith(".") ? `${path.posix.join(path.posix.dirname(from), id)}.tsx` : id
    let mod = cache.get(file)
    if (!mod) {
      if (compiled[file] === undefined) throw new Error(`No module ${id}`)
      mod = { exports: {} }
      cache.set(file, mod)
      new Function("require", "module", "exports", compiled[file])((dep: string) => require(dep, file), mod, mod.exports)
    }
    return mod.exports
  }
  return (file: string) => (require(file) as { default: ComponentType }).default
}

const stampsIn = (el: Element): Stamps[] =>
  [...el.querySelectorAll("*")].map((e) => ({ tag: e.localName, loc: e.getAttribute("data-ad-loc"), use: e.getAttribute("data-ad-use") }))

// Renders Gen with no props, as the Preview page does, and reads back every
// element's stamps and anything React logged.
const run = async (Gen: ComponentType) => {
  const logged: string[] = []
  const log = (...args: unknown[]) => {
    logged.push(format(...args))
  }
  const error = vi.spyOn(console, "error").mockImplementation(log)
  const warn = vi.spyOn(console, "warn").mockImplementation(log)
  document.body.innerHTML = `<div id="root"></div><div id="portal"></div>`
  const root = createRoot(document.getElementById("root")!)
  try {
    await React.act(async () => root.render(React.createElement(Gen)))
    return { root: stampsIn(document.getElementById("root")!), portal: stampsIn(document.getElementById("portal")!), logged }
  } finally {
    await React.act(async () => root.unmount())
    error.mockRestore()
    warn.mockRestore()
  }
}

const sorted = (stamps: Stamps[]) => stamps.map((s) => JSON.stringify(s)).sort()

const runCase = async (files: Record<string, string>) => run((await load(files, workspaceRoot))(MODULES[0]!.file))

test("every DOM node carries the stamps the code says it gets: its own, or the outermost the props brought", async () => {
  await fc.assert(
    fc.asyncProperty(cases, async ({ files, expected }) => {
      const { root, portal } = await runCase(files)
      // Portaled elements land in the target in the order React commits them
      // (a portal inside a portal first), which isn't the stamps' business.
      expect({ root, portal: sorted(portal) }).toEqual({ root: expected.root, portal: sorted(expected.portal) })
    }),
    { numRuns: 200 },
  )
})

test("the stamps make React log nothing", async () => {
  await fc.assert(
    fc.asyncProperty(cases, async ({ files }) => {
      const { logged } = await runCase(files)
      expect(logged).toEqual([])
    }),
    { numRuns: 200 },
  )
})

// Is the element written somewhere in this node?
const hasEl = (n: Node, target: El): boolean => {
  const inEl = (e: El): boolean =>
    e === target || e.attrs.some((a) => (a.kind === "icon" || a.kind === "render") && inEl(a.el)) || !!e.children?.some((c) => hasEl(c, target))
  switch (n.kind) {
    case "el":
    case "portal":
    case "map":
      return inEl(n.el)
    case "frag":
      return n.children.some((c) => hasEl(c, target))
    case "cond":
      return hasEl(n.a, target) || hasEl(n.b, target)
    case "and":
      return hasEl(n.a, target)
    case "array":
      return n.els.some(inEl)
    default:
      return false
  }
}

test("generates the cases that matter", () => {
  // Every way of declaring a component, taking its props and passing them
  // on shows up, or the properties above say little about it.
  const samples = fc.sample(workspace, { numRuns: 300, seed: 1 }).map((w) => ({ w, ...build(w) }))
  const kept = samples.filter((s) => !s.skip)
  // Few cases are left out, for invalid nesting or size.
  expect(kept.length).toBeGreaterThan(samples.length * 0.75)
  const facts = kept.map(({ w, files, facts }) => {
    const all = new Set(facts)
    const comps = [...w.comps, w.gen]
    for (const c of w.comps) {
      all.add(`decl: ${c.decl}`)
      if (c.slot) all.add(`slot: ${c.slot}`)
      else all.add(`style: ${c.style}`)
      if (c.compVar) all.add(`Comp: ${c.compVar}`)
      if (c.generic) all.add("generic")
    }
    const elements = (e: El): void => {
      const t = e.tag
      if (t.kind === "dom") all.add(`<${t.name}>`)
      else if (t.kind === "builtin" || t.kind === "fragment") all.add(`<${t.name}>`)
      else if (t.kind === "var") all.add("<Comp>")
      else {
        if (t.ref.endsWith(".box")) all.add("call: lowercase member")
        if (t.ref.includes("Kit.")) all.add("call: namespace")
        if (w.comps[t.index]!.module !== comps.find((c) => hasEl(c.body, e))?.module) all.add("call: another module")
      }
      if (e.typeArgs) all.add("type arguments")
      const spread = e.attrs.findIndex((a) => a.kind === "spread")
      if (spread !== -1) {
        all.add(`spread onto ${t.kind}`)
        if (e.attrs.slice(spread).some((a) => a.kind !== "spread")) all.add("attribute after a spread")
        if (e.attrs.slice(0, spread).some((a) => a.kind !== "spread")) all.add("attribute before a spread")
      }
      if (e.attrs.some((a) => a.kind === "kept")) all.add(`kept stamp on ${t.kind}`)
      for (const a of e.attrs) {
        if (a.kind === "icon" || a.kind === "render" || a.kind === "asLink" || a.kind === "asChild") all.add(`attr: ${a.kind}`)
        if (a.kind === "icon" || a.kind === "render") elements(a.el)
      }
      e.children?.forEach(nodes)
    }
    const nodes = (n: Node): void => {
      all.add(`node: ${n.kind}`)
      if (n.kind === "el" || n.kind === "portal") elements(n.el)
      else if (n.kind === "frag") n.children.forEach(nodes)
      else if (n.kind === "map") {
        if (n.index !== "i") all.add("node: nested map")
        elements(n.el)
      } else if (n.kind === "cond") [n.a, n.b].forEach(nodes)
      else if (n.kind === "and") nodes(n.a)
      else if (n.kind === "array") n.els.forEach(elements)
    }
    comps.filter((c) => !c.slot).forEach((c) => nodes(c.body))
    all.add(`modules: ${Object.keys(files).length}`)
    return all
  })
  const seen = (fact: string) => facts.filter((f) => f.has(fact)).length
  const expected = [
    ...["function", "arrow", "memo", "forwardRef", "memo-forwardRef", "class", "member"].map((d) => `decl: ${d}`),
    ...["whole", "sig", "body", "picked"].map((s) => `style: ${s}`),
    ...["button", "asLink", "asChild"].map((v) => `Comp: ${v}`),
    "slot: child-wins",
    "slot: slot-wins",
    "generic",
    ...["div", "span", "button", "a", "input", "svg", "path", "my-el"].map((t) => `<${t}>`),
    ...[...BUILTINS, ...FRAGMENTS].map((t) => `<${t}>`),
    "<Comp>",
    "call: lowercase member",
    "call: namespace",
    "call: another module",
    "type arguments",
    "spread onto dom",
    "spread onto comp",
    "spread onto var",
    "attribute after a spread",
    "attribute before a spread",
    "kept stamp on dom",
    "kept stamp on comp",
    "attr: icon",
    "attr: render",
    "attr: asLink",
    "attr: asChild",
    ...["children", "icon", "render", "frag", "portal", "map", "nested map", "cond", "and", "array", "null", "string", "number", "text"].map(
      (k) => `node: ${k}`,
    ),
    "modules: 2",
    "modules: 3",
    "dom: use from another file",
    "dom: use, no loc",
    "dom: loc from a call site",
    "dom: use passed through 2+ components",
    "rendered: asChild",
    ...["child-wins", "slot-wins"].flatMap((m) => [`rendered: ${m} onto dom`, `rendered: ${m} onto comp`]),
  ]
  expect(Object.fromEntries(expected.map((f) => [f, seen(f) >= 10]))).toEqual(Object.fromEntries(expected.map((f) => [f, true])))
})

// The same pipeline as a real dev server: a shadcn-style Button whose <Comp>
// spreads its props, used twice from a user component, and a wrapper that
// passes nothing on. The server's output keeps each stamp ahead of the
// spread, and rendering it gives the DOM the pipeline above gives.
const SERVER_FILES: Record<string, string> = {
  "src/components/ui/button.tsx": `export function Button({ className, ...props }: any) {
  const Comp = "button"
  return <Comp data-slot="button" className={className} {...props} />
}
`,
  "src/components/ui/panel.tsx": `export function Panel({ children }: any) {
  return <section className="panel">{children}</section>
}
`,
  "src/components/user-components/Gen.tsx": `import { Button } from "../ui/button"
import { Panel } from "../ui/panel"

export default function Gen() {
  return (
    <Panel>
      <Button>Save</Button>
      <Button className="ghost">
        <span>Cancel</span>
      </Button>
    </Panel>
  )
}
`,
}

let serverDir: string
beforeAll(() => {
  // Inside the package, so the server finds React in node_modules.
  serverDir = fs.mkdtempSync(path.join(here, ".tag-use-"))
  for (const [file, code] of Object.entries(SERVER_FILES)) {
    fs.mkdirSync(path.dirname(path.join(serverDir, file)), { recursive: true })
    fs.writeFileSync(path.join(serverDir, file), code)
  }
})
afterAll(() => {
  fs.rmSync(serverDir, { recursive: true, force: true })
})

test("a real dev server compiles the stamps the same way: each ahead of the spread", async () => {
  const server = await createServer({
    root: serverDir,
    configFile: false,
    logLevel: "silent",
    plugins: [react(), ...antidraw()],
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, entries: [] },
  })
  try {
    const button = await server.transformRequest("/src/components/ui/button.tsx")
    expect(button!.code).toMatch(
      /jsxDEV\(Comp, \{ "data-ad-use": "src\/components\/ui\/button\.tsx:3:10", "data-slot": "button", className, \.\.\.props \}/,
    )
    const { default: Gen } = (await server.ssrLoadModule("/src/components/user-components/Gen.tsx")) as { default: ComponentType }
    const served = await run(Gen)
    expect(served.logged).toEqual([])
    expect(served.root).toMatchInlineSnapshot(`
      [
        {
          "loc": "src/components/ui/panel.tsx:2:10",
          "tag": "section",
          "use": null,
        },
        {
          "loc": null,
          "tag": "button",
          "use": "src/components/user-components/Gen.tsx:7:7",
        },
        {
          "loc": null,
          "tag": "button",
          "use": "src/components/user-components/Gen.tsx:8:7",
        },
        {
          "loc": "src/components/user-components/Gen.tsx:9:9",
          "tag": "span",
          "use": null,
        },
      ]
    `)
    // The esbuild pipeline the properties use renders the same.
    const ours = await run((await load(SERVER_FILES, serverDir))("src/components/user-components/Gen.tsx"))
    expect(ours).toEqual(served)
  } finally {
    await server.close()
  }
})
