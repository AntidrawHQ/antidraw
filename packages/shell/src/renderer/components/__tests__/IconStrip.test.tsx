// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TooltipProvider } from "@/renderer/components/ui/tooltip";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { IconStrip } from "../../IconStrip";

// Mod+B folds the side panel and unfolds it, and picking a panel unfolds it.
// jsdom's user agent isn't a Mac's, so Mod is Ctrl here.

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<div id="root"></div><textarea></textarea>`;
  host = document.getElementById("root")!;
  root = createRoot(host);
  await act(async () =>
    root.render(
      <TooltipProvider>
        <IconStrip />
      </TooltipProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  useWorkspaceStore.setState({ activeSidePanel: "chat", sidePanelOpen: true });
});

const state = () => {
  const s = useWorkspaceStore.getState();
  return s.sidePanelOpen ? `${s.activeSidePanel} open` : "folded";
};

const press = (init: KeyboardEventInit, target: Element = document.body) => {
  act(() => void target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));
  const keys = [init.metaKey && "Cmd", init.ctrlKey && "Ctrl", init.shiftKey && "Shift", init.key].filter(Boolean).join("+");
  return `${keys}${target === document.body ? "" : " in a text box"}: ${state()}`;
};

const pick = (index: number) => {
  act(() => host.querySelectorAll("button")[index]!.click());
  return `pick tab ${index}: ${state()}`;
};

it("folds and unfolds the side panel", () => {
  expect([
    press({ key: "b", ctrlKey: true }),
    press({ key: "b", ctrlKey: true }),
    press({ key: "b", ctrlKey: true }, document.querySelector("textarea")!),
    press({ key: "b" }),
    press({ key: "b", metaKey: true }),
    press({ key: "B", ctrlKey: true, shiftKey: true }),
    pick(1),
  ]).toMatchInlineSnapshot(`
    [
      "Ctrl+b: folded",
      "Ctrl+b: chat open",
      "Ctrl+b in a text box: folded",
      "b: folded",
      "Cmd+b: folded",
      "Ctrl+Shift+B: folded",
      "pick tab 1: components open",
    ]
  `);
});
