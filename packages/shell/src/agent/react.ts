// What React knows about a DOM node that the DOM doesn't: that a portal's
// content (a dialog, a menu) is the component's, and the element it was
// rendered from. These are React internals, read defensively: where they're
// missing, the answers are empty.

type Fiber = {
  type: unknown
  stateNode: unknown
  return: Fiber | null
  alternate: Fiber | null
}

const fiberOf = (node: Element): Fiber | null => {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"))
  return key ? ((node as unknown as Record<string, Fiber | undefined>)[key] ?? null) : null
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

// Whether React rendered `el` from inside `container`, wherever it sits in
// the DOM: a portal (a dialog, a menu) puts its content under <body>, and
// React's tree still has it under the component that rendered it.
export const renderedWithin = (el: Element, container: Element) => ancestry(el, container).length > 0

// The element above `el` in React's tree: its DOM parent, except at the top
// of a portal, where it's the element the portal was rendered from. Null
// above `container`, or without React's data.
export function reactParent(el: Element, container: Element): Element | null {
  const stop = fiberOf(container)
  for (let f = fiberOf(el)?.return; f; f = f.return) {
    if (same(f, stop)) return container
    if (typeof f.type === "string" && f.stateNode instanceof Element) return f.stateNode
  }
  return null
}
