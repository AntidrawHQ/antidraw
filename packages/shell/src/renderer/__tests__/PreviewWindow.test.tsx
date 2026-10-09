// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ElementInfo } from "@antidrawapp/runtime/inspector";
import { useInspectorStore } from "@/renderer/inspector/store";
import { PreviewWindow } from "../PreviewWindow";

// A frame's own window: its titlebar's tools switch the inspector, and what
// gets tagged here goes to the main window rather than staying.

const URL_ = "https://localhost:5300/preview?componentName=Card";

const info = (): ElementInfo => ({
  ref: { loc: "src/components/user-components/Card.tsx:4:7", index: 0, path: [0], tag: "button" },
  callsite: null,
  tag: "button",
  id: "",
  classes: ["btn"],
  text: "Buy",
  rect: { x: 0, y: 0, width: 10, height: 10 },
  margin: [0, 0, 0, 0],
  border: [0, 0, 0, 0],
  padding: [0, 0, 0, 0],
});

let root: Root;
let host: HTMLElement;
let tagElement: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  tagElement = vi.fn(async () => {});
  (window as unknown as { electronAPI: Partial<Window["electronAPI"]> }).electronAPI = { tagElement };
  document.body.innerHTML = `<div id="root"></div>`;
  host = document.getElementById("root")!;
  root = createRoot(host);
  await act(async () => root.render(<PreviewWindow url={URL_} />));
});

afterEach(() => {
  act(() => root.unmount());
  useInspectorStore.setState({ active: false, frames: {}, selection: null, tags: [] });
});

const active = () =>
  [...host.querySelectorAll("button[aria-pressed=true]")].map((b) => b.getAttribute("aria-label"));

it("shows the component in a frame under a titlebar that names it", () => {
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(URL_);
  expect(document.title).toBe("Card");
  expect(host.textContent).toContain("Card");
});

it("switches the inspector from the titlebar, which has no Comment tool", () => {
  expect(host.querySelector('button[aria-label="Comment"]')).toBeNull();
  expect(active()).toEqual(["Pointer"]);
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Inspect"]')!.click());
  expect([active(), useInspectorStore.getState().active]).toEqual([["Inspect"], true]);
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Pointer"]')!.click());
  expect([active(), useInspectorStore.getState().active]).toEqual([["Pointer"], false]);
});

it("sends what's tagged here to the main window, and says so", () => {
  const pick = { frame: "Card", info: info() };
  act(() => useInspectorStore.getState().addTag(pick));
  expect(tagElement).toHaveBeenCalledExactlyOnceWith(pick, URL_);
  expect(useInspectorStore.getState().tags).toEqual([]);
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Tagged button.btn for Claude");
});
