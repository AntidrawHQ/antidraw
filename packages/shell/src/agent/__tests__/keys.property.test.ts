// @vitest-environment jsdom
import fc from "fast-check"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { startInspector } from "../agent"
import { AGENT_NS, type FromFrame } from "../protocol"

// Keys pressed in a frame with a tool on go to the shell, which keeps what's
// held (React Flow's Space to pan, its modifiers). Whatever happens in the
// frame (keys, modifiers, the tool going off, focus leaving, the page
// going), the shell is never left holding a key, never gets one the
// browser keeps (with Cmd, Ctrl or Alt, a modifier alone, Tab), and never
// hears a key let go it didn't hear pressed.

let sent: FromFrame[]
let stop: () => void

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0)
  vi.stubGlobal("cancelAnimationFrame", () => {})
  sent = []
  vi.spyOn(window, "postMessage").mockImplementation(((msg: FromFrame) => void sent.push(msg)) as typeof window.postMessage)
  document.body.innerHTML = `<div id="frame"><p data-ad-loc="src/components/user-components/Card.tsx:1:1">x</p></div>`
  stop = startInspector(document.getElementById("frame")!, "Card")
})

afterEach(() => {
  stop()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const say = (msg: object) =>
  window.dispatchEvent(new MessageEvent("message", { data: { ns: AGENT_NS, ...msg }, origin: "https://shell.test", source: window }))

const KEYS = ["a", "i", "v", "c", " ", "Enter", "Escape", "ArrowUp", "Backspace", "Shift", "Meta", "Control", "Alt", "Tab"]
const action = fc.oneof(
  fc.record({
    kind: fc.constantFrom("keydown" as const, "keyup" as const),
    key: fc.constantFrom(...KEYS),
    metaKey: fc.boolean(),
    ctrlKey: fc.boolean(),
    altKey: fc.boolean(),
    shiftKey: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("tool" as const), on: fc.constantFrom("inspect" as const, "comment" as const, null) }),
  fc.constant({ kind: "blur" as const }),
  fc.constant({ kind: "pagehide" as const }),
)

test("the shell is never left holding a key, nor given the browser's", () => {
  fc.assert(
    fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
      say({ type: "tool", id: 0, tool: null, wheel: "pass", zoom: 1 })
      sent = []
      // The shell's view, from what it's told.
      const held = new Set<string>()
      const hear = () => {
        for (const m of sent.splice(0)) {
          if (m.type !== "key") continue
          expect(m.metaKey || m.ctrlKey || m.altKey, JSON.stringify(m)).toBe(false)
          expect(["Shift", "Meta", "Control", "Alt", "Tab"]).not.toContain(m.key)
          if (m.kind === "down") held.add(m.code)
          else {
            expect(held.has(m.code), `let go of ${m.code}, never pressed`).toBe(true)
            held.delete(m.code)
          }
        }
      }
      for (const a of actions) {
        if (a.kind === "tool") say({ type: "tool", id: 0, tool: a.on, wheel: "pass", zoom: 1 })
        else if (a.kind === "blur") window.dispatchEvent(new Event("blur"))
        else if (a.kind === "pagehide") window.dispatchEvent(new Event("pagehide"))
        else {
          const { kind, key, ...mods } = a
          document.body.dispatchEvent(new KeyboardEvent(kind, { key, code: key, bubbles: true, cancelable: true, ...mods }))
        }
        hear()
        // The tool off, the frame's focus gone, the page gone: nothing held.
        if ((a.kind === "tool" && !a.on) || a.kind === "blur" || a.kind === "pagehide") expect([...held]).toEqual([])
      }
      say({ type: "tool", id: 0, tool: null, wheel: "pass", zoom: 1 })
      hear()
      expect([...held]).toEqual([])
    }),
    { numRuns: 300 },
  )
})
