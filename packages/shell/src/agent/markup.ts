// An element's markup as an agent is given it: what DevTools' Elements panel
// shows, cut short. Children go a few levels down and only so many at each,
// text and attribute values are clipped, and an <svg>'s drawing is left out
// (its class names the icon). One element or text per line, nested two
// spaces; a short text stays on its element's line.

const DEPTH = 3
const CHILDREN = 8
const LINES = 60
const TEXT = 80
const VALUE = 200

// Elements with no closing tag.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])
// Elements whose content is code or a drawing, not markup to read.
const OPAQUE = new Set(["svg", "script", "style", "template"])

// Never half a character: a cut after the first half of a pair (an emoji)
// goes before it.
const clip = (s: string, max: number) => {
  if (s.length <= max) return s
  const end = /[\uD800-\uDBFF]/.test(s[max - 2]!) ? max - 2 : max - 1
  return `${s.slice(0, end)}…`
}
const collapse = (s: string) => s.replace(/\s+/g, " ").trim()
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeValue = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

// React sets a checkbox's checked attribute once; the property is what's on
// screen.
const attributesOf = (el: Element) => {
  const attributes = [...el.attributes].map((a) => [a.name, a.value] as const)
  if (!(el instanceof HTMLInputElement) || (el.type !== "checkbox" && el.type !== "radio")) return attributes
  const others = attributes.filter(([name]) => name !== "checked")
  return el.checked ? [...others, ["checked", ""] as const] : others
}

export function openingTag(el: Element) {
  const attributes = attributesOf(el).map(([name, value]) =>
    value === "" ? ` ${name}` : ` ${name}="${escapeValue(clip(collapse(value), VALUE))}"`,
  )
  return `<${el.localName}${attributes.join("")}>`
}

export function markupOf(root: Element): string {
  const lines: string[] = []
  const pad = (depth: number) => "  ".repeat(depth)

  const write = (el: Element, depth: number) => {
    const open = openingTag(el)
    const tag = el.localName
    if (VOID.has(tag)) return void lines.push(pad(depth) + open)
    const close = `</${tag}>`
    // A template parsed from HTML holds its children in its content.
    const nodes = el instanceof HTMLTemplateElement ? [...el.content.childNodes, ...el.childNodes] : [...el.childNodes]
    const children = nodes.filter(
      (n) => n instanceof Element || (n.nodeType === Node.TEXT_NODE && collapse(n.nodeValue ?? "")),
    )
    if (!children.length) return void lines.push(pad(depth) + open + close)
    if (OPAQUE.has(tag) || depth >= DEPTH) return void lines.push(`${pad(depth)}${open}…${close}`)
    const only = children.length === 1 ? children[0]! : null
    if (only && only.nodeType === Node.TEXT_NODE) {
      return void lines.push(pad(depth) + open + escapeText(clip(collapse(only.nodeValue!), TEXT)) + close)
    }
    lines.push(pad(depth) + open)
    // So many children, while the whole is short enough; the rest counted.
    let shown = 0
    for (const child of children) {
      if (shown === CHILDREN || lines.length >= LINES) break
      if (child instanceof Element) write(child, depth + 1)
      else lines.push(pad(depth + 1) + escapeText(clip(collapse(child.nodeValue!), TEXT)))
      shown++
    }
    if (shown < children.length) lines.push(`${pad(depth + 1)}… ${children.length - shown} more`)
    lines.push(pad(depth) + close)
  }

  write(root, 0)
  return lines.join("\n")
}
