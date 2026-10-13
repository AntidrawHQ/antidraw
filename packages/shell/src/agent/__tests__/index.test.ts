// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest"
import { AGENT_NS, type FromFrame } from "../protocol"

// What main runs in a preview frame: the agent, once, on the element the
// component is in, following it as it comes and goes.

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

const readies = () => {
  const sent: FromFrame[] = []
  vi.spyOn(window, "postMessage").mockImplementation(((msg: FromFrame) => {
    if (msg.type === "ready") sent.push(msg)
  }) as typeof window.postMessage)
  return sent
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// First: an agent, once started, stays for the page.
test("has no agent on the page's full-screen view", async () => {
  history.replaceState(null, "", "/preview?componentName=Card&fullscreen=true")
  document.body.innerHTML = `<div id="root"></div>`
  const sent = readies()
  await import("../index")
  expect(sent).toEqual([])
})

test("starts on what the page's root holds until the component's element is there, then on that, and only once a page", async () => {
  history.replaceState(null, "", "/preview?componentName=Card")
  document.body.innerHTML = `<div id="root"><p>Loading</p></div>`
  const sent = readies()
  await import("../index")
  expect(sent).toEqual([{ ns: AGENT_NS, type: "ready", componentName: "Card", tagged: false, provisional: true }])

  // The component loads, in its element.
  document.getElementById("root")!.innerHTML = `<div data-ad-preview="Card"><h3 data-ad-loc="src/components/user-components/Card.tsx:3:5">Pro</h3></div>`
  await settle()
  expect(sent.at(-1)).toEqual({ ns: AGENT_NS, type: "ready", componentName: "Card", tagged: true })

  // A render error swaps the component's element for an error: no agent
  // (not the page's root, where the selection can't be found), until it's
  // back.
  const before = sent.length
  document.getElementById("root")!.innerHTML = `<div class="error">Component "Card" not found</div>`
  await settle()
  expect(sent.length).toBe(before)
  document.getElementById("root")!.innerHTML = `<div data-ad-preview="Card"><h3 data-ad-loc="src/components/user-components/Card.tsx:3:5">Pro</h3></div>`
  await settle()
  expect(sent.length).toBe(before + 1)

  // Run again (a second injection into the same page): nothing more.
  vi.resetModules()
  const count = sent.length
  await import("../index")
  await settle()
  expect(sent.length).toBe(count)
})
