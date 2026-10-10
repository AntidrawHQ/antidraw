// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it } from "vitest";

// The tree holds the main window's pages too, which read media queries as they load.
window.matchMedia ??= (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;
const { routeTree } = await import("../routeTree.gen");

// A frame's own window is the app's /preview route: the frame its `url`
// names, under its own titlebar, without the main window's chrome. Only a
// dev server's preview page.

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const open = async (href: string) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<div id="root"></div>`;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [href] }),
    context: { queryClient: new QueryClient() },
  });
  await router.load();
  root = createRoot(document.getElementById("root")!);
  await act(async () => root!.render(<RouterProvider router={router} />));
  return document.body;
};

const preview = "https://localhost:5300/preview?componentName=Card";

it("shows the frame its url names, without the main window's chrome", async () => {
  const page = await open(`/preview?${new URLSearchParams({ url: preview })}`);
  expect(page.querySelector("iframe")?.getAttribute("src")).toBe(preview);
  expect(page.querySelector('[aria-label="Notifications"]')).toBeNull();
});

it("frames nothing but a dev server's preview page", async () => {
  for (const url of ["https://example.com/preview", "http://localhost:5300/preview", "javascript:alert(1)", ""]) {
    const page = await open(`/preview?${new URLSearchParams({ url })}`);
    expect([url, page.querySelector("iframe"), page.textContent]).toEqual([url, null, "Nothing to preview here."]);
    act(() => root?.unmount());
    root = null;
  }
});
