// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ElementInfo } from "@antidrawapp/runtime/inspector";
import { InspectorControls } from "../InspectorControls";
import { useInspectorStore } from "../store";

// Which keys the inspector takes while inspecting: those pressed on the
// canvas or with nothing focused, and not those a menu, dialog or panel has.

const info: ElementInfo = {
  ref: { loc: "src/components/user-components/Card.tsx:4:7", index: 0, path: [0], tag: "h3" },
  callsite: null,
  tag: "h3",
  id: "",
  classes: [],
  text: "Pro plan",
  rect: { x: 0, y: 0, width: 10, height: 10 },
  margin: [0, 0, 0, 0],
  border: [0, 0, 0, 0],
  padding: [0, 0, 0, 0],
};

let root: Root;
let canvas: HTMLElement;
let menu: HTMLElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<div class="react-flow"><div class="react-flow__node" tabindex="0"></div><div id="root"></div></div>
    <div role="menu" tabindex="-1"><div role="menuitem" tabindex="-1">Opus</div></div>`;
  canvas = document.querySelector(".react-flow__node")!;
  menu = document.querySelector("[role=menuitem]")!;
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<ReactFlowProvider><InspectorControls /></ReactFlowProvider>));
});

afterEach(() => {
  act(() => root.unmount());
  useInspectorStore.setState({ active: false, selection: null, tags: [] });
});

// Presses a key at a target; says whether the inspector took it and what's left.
const press = (key: string, target: Element, { handledBy }: { handledBy?: "a menu" } = {}) => {
  useInspectorStore.setState({ active: true, selection: { frame: "Card", info }, tags: [] });
  // As Radix does: on the document, capturing, marking the key handled.
  const layer = (e: KeyboardEvent) => e.preventDefault();
  if (handledBy) document.addEventListener("keydown", layer, true);
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(event));
  document.removeEventListener("keydown", layer, true);
  const s = useInspectorStore.getState();
  const where = target === document.body ? "nothing focused" : target === canvas ? "the canvas" : "a menu";
  return `${key} on ${where}${handledBy ? `, handled by ${handledBy}` : ""}: ${
    s.selection ? "selected" : "cleared"
  }, ${s.active ? "inspecting" : "not inspecting"}, ${s.tags.length} tagged`;
};

it("takes keys on the canvas and with nothing focused, and leaves a menu's alone", () => {
  expect([
    press("Escape", document.body),
    press("Escape", canvas),
    press("Escape", menu),
    press("Escape", canvas, { handledBy: "a menu" }),
    press("Enter", canvas),
    press("Enter", menu),
    press("i", menu),
    press("i", document.body),
  ]).toMatchInlineSnapshot(`
    [
      "Escape on nothing focused: cleared, inspecting, 0 tagged",
      "Escape on the canvas: cleared, inspecting, 0 tagged",
      "Escape on a menu: selected, inspecting, 0 tagged",
      "Escape on the canvas, handled by a menu: selected, inspecting, 0 tagged",
      "Enter on the canvas: selected, inspecting, 1 tagged",
      "Enter on a menu: selected, inspecting, 0 tagged",
      "i on a menu: selected, inspecting, 0 tagged",
      "i on nothing focused: selected, not inspecting, 0 tagged",
    ]
  `);
});
