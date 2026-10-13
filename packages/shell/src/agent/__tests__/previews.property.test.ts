// @vitest-environment jsdom
import fc from "fast-check"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../agent"
import { AGENT_NS, EDIT_ATTRIBUTE, type FromFrame, type PreviewItem, type ToFrame } from "../protocol"

// The design edits a frame previews live in the page, which React keeps
// changing: it replaces an element, takes one away and brings it back, and
// writes an element's text again when its code changes. Whatever happens,
// every element carries exactly its edits' keys, the shell hears which edits
// have no element, an edit's text is the text shown, and once the previews
// end the page is as its code has it: no attribute left, and each element's
// text its code's, the latest, not what it said before the preview.

const OWN = "src/components/user-components/Card.tsx"
const N = 4

let stop: () => void
let sent: FromFrame[]
let queued: Map<number, FrameRequestCallback>
let lastFrameId: number
let container: HTMLElement

beforeEach(() => {
  queued = new Map()
  lastFrameId = 0
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    queued.set(++lastFrameId, fn)
    return lastFrameId
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queued.delete(id))
  sent = []
  vi.spyOn(window, "postMessage").mockImplementation(((msg: FromFrame) => {
    sent.push(msg)
  }) as typeof window.postMessage)
})

afterEach(() => {
  stop?.()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const ask = (msg: ToFrame) =>
  window.dispatchEvent(new MessageEvent("message", { data: { ns: AGENT_NS, ...msg }, origin: "https://canvas.test", source: window }))
// The page's mutations, then the frame they're looked at in.
const frames = async () => {
  await Promise.resolve()
  for (const [id, fn] of [...queued]) {
    queued.delete(id)
    fn(0)
  }
  await Promise.resolve()
}

// A tag each: an edit whose element is gone must find none, not the sibling
// that moved into its place (find() falls back to the element's place among
// its siblings, of the same tag, for a location that's gone).
const TAGS = ["button", "a", "span", "label"]
const loc = (i: number) => `${OWN}:${i + 1}:5`
const ref = (i: number) => ({ loc: loc(i), index: 0, path: [i], tag: TAGS[i]! })
// Element i as React renders it from its code: some with an icon before the
// text, the text with the spaces JSX leaves around it.
const render = (i: number, text: string) => {
  const el = document.createElement(TAGS[i]!)
  el.setAttribute("data-ad-loc", loc(i))
  if (i % 2) el.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"))
  el.append(document.createTextNode(` ${text} `))
  return el
}
const elementOf = (i: number) => container.querySelector<HTMLElement>(`[data-ad-loc="${CSS.escape(loc(i))}"]`)
const textNodeOf = (el: Element) => [...el.childNodes].find((n): n is Text => n.nodeType === Node.TEXT_NODE)!

const words = fc.constantFrom("Buy", "Buy now", "Start", "$& trial", "  ", "Ünïcødé 🙂")
const item = fc.record({
  i: fc.nat(N - 1),
  key: fc.constantFrom("e1", "e2", "e3", "a7-1"),
  css: fc.dictionary(fc.constantFrom("gap", "color", "padding"), fc.constantFrom("4px", "red", "8px"), { maxKeys: 2 }),
  text: fc.option(words.filter((w) => w.trim() !== ""), { nil: undefined }),
})
const step = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("preview" as const), items: fc.uniqueArray(item, { selector: (x) => x.key, maxLength: 4 }) }) },
  fc.record({ kind: fc.constant("replace" as const), i: fc.nat(N - 1) }),
  fc.record({ kind: fc.constant("remove" as const), i: fc.nat(N - 1) }),
  fc.record({ kind: fc.constant("restore" as const), i: fc.nat(N - 1) }),
  // Its code changed: React writes the new text into the node it keeps.
  fc.record({ kind: fc.constant("code" as const), i: fc.nat(N - 1), text: words.filter((w) => w.trim() !== "") }),
)

test("keeps each element's edits on it, says which have none, and leaves the page as its code has it", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 20 }), async (steps) => {
      document.head.querySelectorAll("style[data-antidraw-agent]").forEach((s) => s.remove())
      document.body.innerHTML = `<div id="frame"></div>`
      container = document.getElementById("frame")!
      // Each element's text as its code has it now, and whether it's rendered.
      const code = Array.from({ length: N }, (_, i) => `Label ${i}`)
      const shown = Array.from({ length: N }, () => true)
      code.forEach((t, i) => container.append(render(i, t)))
      stop?.()
      stop = startInspector(container, "Card")
      sent = []
      let items: (PreviewItem & { i: number })[] = []

      const check = () => {
        for (let i = 0; i < N; i++) {
          const el = elementOf(i)
          expect(!!el, `element ${i} shown`).toBe(shown[i])
          if (!el) continue
          const mine = items.filter((x) => x.i === i)
          expect(el.getAttribute(EDIT_ATTRIBUTE) ?? "", `keys on ${i}`).toBe(mine.map((x) => x.key).join(" "))
          const text = mine.filter((x) => x.text !== undefined).at(-1)?.text ?? code[i]
          expect(textNodeOf(el).nodeValue, `text of ${i}`).toBe(` ${text} `)
        }
        const said = sent.filter((m): m is Extract<FromFrame, { type: "previewed" }> => m.type === "previewed").at(-1)
        const missing = items.filter((x) => !shown[x.i]).map((x) => x.key)
        if (items.length) expect(said?.missing, "missing").toEqual(missing)
      }

      for (const s of steps) {
        if (s.kind === "preview") {
          items = s.items.map((x) => ({ key: x.key, ref: ref(x.i), css: x.css, ...(x.text !== undefined && { text: x.text }), i: x.i }))
          ask({ type: "preview", id: 1, items: items.map(({ i: _, ...x }) => x) })
        } else if (s.kind === "replace" && shown[s.i]) elementOf(s.i)!.replaceWith(render(s.i, code[s.i]!))
        else if (s.kind === "remove" && shown[s.i]) {
          elementOf(s.i)!.remove()
          shown[s.i] = false
        } else if (s.kind === "restore" && !shown[s.i]) {
          container.append(render(s.i, code[s.i]!))
          shown[s.i] = true
        } else if (s.kind === "code") {
          code[s.i] = s.text
          const el = elementOf(s.i)
          if (el) textNodeOf(el).nodeValue = ` ${s.text} `
        }
        await frames()
        check()
      }

      // The previews end: the page is its code's.
      items = []
      ask({ type: "preview", id: 2, items: [] })
      await frames()
      check()
      expect(container.querySelector(`[${EDIT_ATTRIBUTE}]`)).toBeNull()
      expect(document.head.querySelector("style[data-antidraw-agent]")).toBeNull()
    }),
    { numRuns: 300 },
  )
})

test("generates the cases that matter", () => {
  const runs = fc.sample(fc.array(step, { minLength: 1, maxLength: 20 }), { numRuns: 300, seed: 1 })
  const seen = (pred: (steps: (typeof runs)[number]) => boolean) => runs.filter(pred).length
  // A text edit, and then the code changing that element's text.
  expect(
    seen((steps) =>
      steps.some(
        (s, k) =>
          s.kind === "preview" && s.items.some((x) => x.text !== undefined && steps.slice(k + 1).some((t) => t.kind === "code" && t.i === x.i)),
      ),
    ),
  ).toBeGreaterThan(25)
  // An element replaced or taken away while it has edits.
  expect(
    seen((steps) =>
      steps.some(
        (s, k) =>
          s.kind === "preview" &&
          s.items.some((x) => steps.slice(k + 1).some((t) => (t.kind === "replace" || t.kind === "remove") && t.i === x.i)),
      ),
    ),
  ).toBeGreaterThan(25)
  // Two edits on one element.
  expect(seen((steps) => steps.some((s) => s.kind === "preview" && new Set(s.items.map((x) => x.i)).size < s.items.length))).toBeGreaterThan(25)
})
