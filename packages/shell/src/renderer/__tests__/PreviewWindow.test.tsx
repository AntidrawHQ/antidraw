// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PreviewWindow } from "../PreviewWindow";

// A frame's own window: its component under a titlebar that names it, with
// the canvas's Pointer and Comment tools when it has a workspace.

const URL_ = "https://localhost:5300/preview?componentName=Card";
const WORKSPACE = "7d4a1b84-e8ea-4cfd-bb2a-48387ee73c04";

let root: Root;
let host: HTMLElement;

const open = async (workspaceId?: string) => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
        <PreviewWindow url={URL_} workspaceId={workspaceId} />
      </QueryClientProvider>,
    ),
  );
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<div id="root"></div>`;
  host = document.getElementById("root")!;
  root = createRoot(host);
});

afterEach(() => act(() => root.unmount()));

const buttons = () => [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));

it("shows the component in a frame under a titlebar that names it", async () => {
  await open();
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(URL_);
  // Its forms, alerts, links and copying work as on its own page.
  expect(host.querySelector("iframe")?.getAttribute("sandbox")?.split(" ")).toEqual(
    expect.arrayContaining(["allow-forms", "allow-modals", "allow-popups"]),
  );
  expect(document.title).toBe("Card");
  expect(host.textContent).toContain("Card");
});

it("has Pointer and Comment with a workspace, no tools without one, and never Inspect", async () => {
  await open();
  expect(buttons()).toEqual(["Refresh"]);
  await open(WORKSPACE);
  expect(buttons()).toEqual(["Pointer", "Comment", "Refresh"]);
});

it("doesn't take focus from a click on a titlebar button, which would ring it", async () => {
  await open(WORKSPACE);
  for (const label of ["Pointer", "Comment", "Refresh"]) {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => void host.querySelector(`button[aria-label="${label}"]`)!.dispatchEvent(down));
    expect([label, down.defaultPrevented]).toEqual([label, true]);
  }
});
