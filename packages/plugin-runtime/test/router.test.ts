import { expect, test, vi } from "vitest"

// Safari allows a page 100 history.replaceState calls per 10 seconds, across
// all its frames. A canvas loads one Preview page per component, so the
// router must never write the page's history: it reads the component from
// the URL it was loaded with and keeps its own history in memory.
test("the Preview router reads the page URL and never writes browser history", async () => {
  const history = { pushState: vi.fn(), replaceState: vi.fn() }
  vi.stubGlobal("window", {
    location: { pathname: "/preview", search: "?componentName=Hero%20Card&fullscreen=true" },
    history,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  const { router } = await import("../src/router")
  await router.load()

  expect({
    pathname: router.state.location.pathname,
    search: router.state.location.search,
    matched: router.state.matches.map((m) => m.routeId),
    historyWrites: history.replaceState.mock.calls.length + history.pushState.mock.calls.length,
  }).toMatchInlineSnapshot(`
    {
      "historyWrites": 0,
      "matched": [
        "__root__",
        "/preview",
      ],
      "pathname": "/preview",
      "search": {
        "componentName": "Hero Card",
        "fullscreen": true,
      },
    }
  `)
})
