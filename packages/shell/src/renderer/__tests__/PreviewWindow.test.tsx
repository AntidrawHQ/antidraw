// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PreviewWindow } from "../PreviewWindow";

// A frame's own window: its component under a titlebar that names it.

const URL_ = "https://localhost:5300/preview?componentName=Card";

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = `<div id="root"></div>`;
  host = document.getElementById("root")!;
  root = createRoot(host);
  await act(async () => root.render(<PreviewWindow url={URL_} />));
});

afterEach(() => act(() => root.unmount()));

it("shows the component in a frame under a titlebar that names it", () => {
  expect(host.querySelector("iframe")?.getAttribute("src")).toBe(URL_);
  // Its forms, alerts, links and copying work as on its own page.
  expect(host.querySelector("iframe")?.getAttribute("sandbox")?.split(" ")).toEqual(
    expect.arrayContaining(["allow-forms", "allow-modals", "allow-popups"]),
  );
  expect(document.title).toBe("Card");
  expect(host.textContent).toContain("Card");
});

it("has only Refresh in its titlebar", () => {
  expect(host.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
  expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Refresh"]);
});

it("doesn't take focus from a click on a titlebar button, which would ring it", () => {
  for (const label of ["Pointer", "Inspect", "Refresh"]) {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => void host.querySelector(`button[aria-label="${label}"]`)!.dispatchEvent(down));
    expect([label, down.defaultPrevented]).toEqual([label, true]);
  }
});
