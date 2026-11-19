// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

// What a frame's Preview page tells the canvas around it. The canvas holds a
// frame's place in its loading queue until the frame says its component has
// rendered or failed.

let search: { componentName?: string; fullscreen?: boolean } = {}
vi.mock("@tanstack/react-router", () => ({ useSearch: () => search }))
vi.mock("../src/load-component", () => ({
  loadComponent: async (name: string) => {
    if (name === "Missing") throw new Error("Failed to fetch dynamically imported module")
    if (name === "Throws") return { default: () => { throw new Error("boom") } }
    return { default: () => <p>{name}</p> }
  },
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

// The messages the page posts to its parent once it has settled.
async function told(page: typeof search) {
  search = page
  const posted = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})
  // React logs what the error boundary catches.
  vi.spyOn(console, "error").mockImplementation(() => {})
  const { Preview } = await import("../src/pages/Preview")
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await act(async () => root!.render(<Preview />))
  await act(async () => {})
  const messages = posted.mock.calls
    .map(([message]) => message as { type: string; componentName: string })
    .map(({ type, componentName }) => `${type}: ${componentName}`)
  act(() => root!.unmount())
  root = undefined
  posted.mockClear()
  return messages
}

test("a frame tells the canvas its component rendered, or that it never will", async () => {
  expect({
    renders: await told({ componentName: "Card" }),
    "file is missing": await told({ componentName: "Missing" }),
    "throws as it renders": await told({ componentName: "Throws" }),
    "name can't be loaded": await told({ componentName: "a?b" }),
    "full screen, with no canvas": await told({ componentName: "Missing", fullscreen: true }),
  }).toEqual({
    renders: ["component-size: Card"],
    "file is missing": ["component-failed: Missing"],
    "throws as it renders": ["component-failed: Throws"],
    "name can't be loaded": ["component-failed: a?b"],
    "full screen, with no canvas": [],
  })
})
