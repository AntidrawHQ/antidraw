// An element's markup as an agent is given it: what DevTools' Elements panel
// shows, cut short. Children go a few levels down and only so many at each,
// so many lines and characters in all, text and attribute values are
// clipped, and an <svg>'s drawing is left out (its class names the icon).
// One element or text per line, nested two spaces; a short text stays on its
// element's line. What a form holds is as it is on screen, but a secret:
// a password, a hidden field, a card number.

const DEPTH = 3
const CHILDREN = 8
const LINES = 60
const CHARS = 6000
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

// A field whose value isn't the agent's to read.
const SECRET_AUTOCOMPLETE = /\b(cc-|current-password|new-password|one-time-code)/i
const isSecret = (el: HTMLInputElement) =>
  el.type === "password" || el.type === "hidden" || SECRET_AUTOCOMPLETE.test(el.getAttribute("autocomplete") ?? "")

// What's on screen, not what React first wrote: it sets a checkbox's checked
// attribute, an option's selected and an input's value once, and the
// properties change after. A secret's value is left out.
const attributesOf = (el: Element) => {
  let attributes: (readonly [string, string])[] = [...el.attributes].map((a) => [a.name, a.value] as const)
  const set = (name: string, value: string | null) => {
    attributes = attributes.filter(([n]) => n !== name)
    if (value !== null) attributes.push([name, value])
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") set("checked", el.checked ? "" : null)
    else if (isSecret(el)) set("value", null)
    else if (el.type !== "file") set("value", el.value || null)
  } else if (el instanceof HTMLOptionElement) set("selected", el.selected ? "" : null)
  return attributes
}

export function openingTag(el: Element) {
  const attributes = attributesOf(el).map(([name, value]) =>
    value === "" ? ` ${name}` : ` ${name}="${escapeValue(clip(collapse(value), VALUE))}"`,
  )
  return `<${el.localName}${attributes.join("")}>`
}

// `skip`: an element of the inspector's own, left out.
export function markupOf(root: Element, skip: (el: Element) => boolean = () => false): string {
  const lines: string[] = []
  let chars = 0
  const push = (line: string) => {
    lines.push(line)
    chars += line.length + 1
  }
  const pad = (depth: number) => "  ".repeat(depth)

  const write = (el: Element, depth: number) => {
    const open = openingTag(el)
    const tag = el.localName
    if (VOID.has(tag)) return void push(pad(depth) + open)
    const close = `</${tag}>`
    // A template parsed from HTML holds its children in its content; a
    // textarea shows its value, which its text only started as.
    const nodes =
      el instanceof HTMLTemplateElement
        ? [...el.content.childNodes, ...el.childNodes]
        : el instanceof HTMLTextAreaElement
          ? [document.createTextNode(el.value)]
          : [...el.childNodes]
    const children = nodes.filter(
      (n) => (n instanceof Element && !skip(n)) || (n.nodeType === Node.TEXT_NODE && collapse(n.nodeValue ?? "")),
    )
    if (!children.length) return void push(pad(depth) + open + close)
    if (OPAQUE.has(tag) || depth >= DEPTH) return void push(`${pad(depth)}${open}…${close}`)
    const only = children.length === 1 ? children[0]! : null
    if (only && only.nodeType === Node.TEXT_NODE) {
      return void push(pad(depth) + open + escapeText(clip(collapse(only.nodeValue!), TEXT)) + close)
    }
    push(pad(depth) + open)
    // So many children, while the whole is short enough; the rest counted.
    let shown = 0
    for (const child of children) {
      if (shown === CHILDREN || lines.length >= LINES || chars >= CHARS) break
      if (child instanceof Element) write(child, depth + 1)
      else push(pad(depth + 1) + escapeText(clip(collapse(child.nodeValue!), TEXT)))
      shown++
    }
    if (shown < children.length) push(`${pad(depth + 1)}… ${children.length - shown} more`)
    push(pad(depth) + close)
  }

  write(root, 0)
  return lines.join("\n")
}
