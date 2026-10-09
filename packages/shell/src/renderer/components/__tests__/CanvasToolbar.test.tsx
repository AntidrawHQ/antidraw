// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TooltipProvider } from "@/renderer/components/ui/tooltip";
import { useInspectorStore } from "@/renderer/inspector/store";
import { useCommentStore } from "@/renderer/comments/store";
import { CanvasToolbar } from "../CanvasToolbar";

// Which tool the rail shows as active, and what clicking each one does to
// the inspector. Comment turns the inspector off.

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<div id="root"></div>`;
  host = document.getElementById("root")!;
  root = createRoot(host);
  await act(async () =>
    root.render(
      <TooltipProvider>
        <ReactFlowProvider>
          <CanvasToolbar />
        </ReactFlowProvider>
      </TooltipProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  useInspectorStore.setState({ active: false, selection: null, tags: [] });
  useCommentStore.setState({ active: false });
});

// Clicks a tool; says which tool is active and whether the inspector is on.
const click = (label: string) => {
  act(() => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  const active = [...host.querySelectorAll("button[aria-pressed=true]")].map((b) => b.getAttribute("aria-label"));
  return `${label}: ${active.join(", ")} active, ${useInspectorStore.getState().active ? "inspecting" : "not inspecting"}`;
};

it("switches the inspector from the rail", () => {
  expect([
    click("Pointer"),
    click("Inspect"),
    click("Comment"),
    click("Inspect"),
    click("Inspect"),
    click("Pointer"),
  ]).toMatchInlineSnapshot(`
    [
      "Pointer: Pointer active, not inspecting",
      "Inspect: Inspect active, inspecting",
      "Comment: Comment active, not inspecting",
      "Inspect: Inspect active, inspecting",
      "Inspect: Inspect active, inspecting",
      "Pointer: Pointer active, not inspecting",
    ]
  `);
});

it("follows the inspector when I turns it on", () => {
  act(() => useInspectorStore.getState().setActive(true));
  expect(host.querySelector("button[aria-pressed=true]")?.getAttribute("aria-label")).toMatchInlineSnapshot(`"Inspect"`);
});
