// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ElementContext, ElementInfo } from "@/agent/protocol";
import { useInspectorStore } from "@/renderer/inspector/store";
import { PreviewWindow } from "../PreviewWindow";

// A frame's own window: its titlebar's tools switch the inspector, and what
// gets tagged here goes to the main window rather than staying.

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

it("sends what's tagged here to the main window, as this window saw it, and says so", async () => {
  const seen = { viewport: [1440, 900], element: "button.btn", text: "Buy" } as ElementContext;
  const pick = { frame: "Card", info: info(), seen };
  await act(async () => useInspectorStore.getState().addTag(pick));
  expect(tagElement).toHaveBeenCalledExactlyOnceWith(pick, URL_);
  expect(useInspectorStore.getState().tags).toEqual([]);
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Tagged button.btn for Claude");
});

it("takes the inspector's keys with a titlebar tool focused, as it is once clicked", async () => {
  const press = (key: string, target: HTMLElement) => {
    target.focus();
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    act(() => void target.dispatchEvent(event));
    return event.defaultPrevented;
  };
  const tool = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  press("i", tool("Pointer"));
  expect(useInspectorStore.getState().active).toBe(true);

  const pick = { frame: "Card", info: info() };
  useInspectorStore.setState({ selection: pick });
  // Taken by the inspector, so the focused Refresh isn't pressed too.
  expect(press("Enter", tool("Refresh"))).toBe(true);
  await act(async () => {});
  // Its frame isn't ready here, so it couldn't say.
  expect(tagElement).toHaveBeenCalledExactlyOnceWith({ ...pick, seen: null }, URL_);

  press("v", tool("Inspect"));
  expect(useInspectorStore.getState().active).toBe(false);
});

it("doesn't take focus from a click on a titlebar button, which would ring it", () => {
  for (const label of ["Pointer", "Inspect", "Refresh"]) {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => void host.querySelector(`button[aria-label="${label}"]`)!.dispatchEvent(down));
    expect([label, down.defaultPrevented]).toEqual([label, true]);
  }
});
