// What React's development build knows about a DOM node that the DOM doesn't:
// the components whose code rendered it, and its list key. These are React
// internals, read defensively: where they're missing (a production build),
// the answers are empty.

type Fiber = {
  type: unknown
  elementType: unknown
  key: string | null
  return: Fiber | null
  alternate: Fiber | null
  _debugOwner?: Fiber | null
}

const fiberOf = (node: Element): Fiber | null => {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"))
  return key ? ((node as unknown as Record<string, Fiber | undefined>)[key] ?? null) : null
}

const nameOf = (type: unknown): string | null => {
  if (typeof type === "function") return (type as { displayName?: string }).displayName || type.name || null
  if (type && typeof type === "object") {
    // memo() and forwardRef() wrap the function.
    const wrapper = type as { displayName?: string; type?: unknown; render?: unknown }
    return wrapper.displayName || nameOf(wrapper.type ?? wrapper.render)
  }
  return null
}

const LAZY = Symbol.for("react.lazy")

// esbuild renames the function in `const Row = memo(function Row() {…})`,
// whose name shadows the variable's, to Row2 (and H2's to H22): the code
// says Row. Only memo() and forwardRef(); lazy() wraps a function esbuild
// left alone (the previewed component, Hero2, is loaded through one).
const componentName = (fiber: Fiber) => {
  const name = nameOf(fiber.type)
  const wrapper = fiber.elementType as { $$typeof?: symbol; displayName?: string } | null
  const renamed = !!wrapper && typeof wrapper === "object" && wrapper.$$typeof !== LAZY && !wrapper.displayName
  return name && renamed ? name.replace(/(?<=.)[2-9]$/, "") : name
}

// A fiber and its alternate are the same instance, at different renders.
const same = (a: Fiber | null | undefined, b: Fiber | null | undefined) =>
  !!a && !!b && (a === b || a.alternate === b)

// The fibers from `el` up to `container`'s, or none if it can't get there.
const ancestry = (el: Element, container: Element): Fiber[] => {
  const stop = fiberOf(container)
  const chain: Fiber[] = []
  for (let f = fiberOf(el); f; f = f.return) {
    if (same(f, stop)) return chain
    chain.push(f)
  }
  return []
}

export type Owner = { name: string; owns: (node: Element) => boolean }

// The components whose code rendered `el` (each owner, and its owner), from
// the outermost inside `container` in.
export function ownersOf(el: Element, container: Element): Owner[] {
  const chain = ancestry(el, container)
  const within = (f: Fiber) => chain.some((c) => same(c, f))
  const owners: Owner[] = []
  for (let o = chain[0]?._debugOwner; o && within(o); o = o._debugOwner) {
    const owner = o
    owners.unshift({
      name: componentName(owner) ?? "Anonymous",
      owns: (node) => same(fiberOf(node)?._debugOwner, owner),
    })
  }
  return owners
}

// The React keys on and around `el`, outermost first: which item of which
// list it's in ("pro" > "export" for a plan's feature).
export const keysOf = (el: Element, container: Element): string[] =>
  ancestry(el, container)
    .map((f) => f.key)
    .filter((key) => key !== null)
    .reverse()
