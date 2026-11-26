// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// ⌘F (Ctrl+F here: jsdom isn't a Mac) opens the find. Typing and ↓ / ↑ only
// move the highlight; ↵ (or a click) goes to it, as a jump, not a flight.
// Esc, or a click outside it, closes it and the query is kept.

const focus = vi.fn();
vi.mock("@/renderer/canvas/Canvas", () => ({ useFocusComponent: () => focus }));

const { CanvasFind } = await import("../CanvasFind");

const COMPONENTS = ["PricingCard", "HeroSection", "ProfileCard", "CheckoutForm"].map((name) => ({ name }));

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  vi.useFakeTimers();
  focus.mockClear();
  document.body.innerHTML = `<div id="root"></div>`;
  host = document.getElementById("root")!;
  root = createRoot(host);
  await act(async () => root.render(<CanvasFind components={COMPONENTS} />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const input = () => host.querySelector("input");
const key = (target: EventTarget, init: KeyboardEventInit) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
const type = (text: string) =>
  act(() => {
    const el = input()!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const rows = () => [...host.querySelectorAll("button[data-i]")].map((b) => b.textContent);
const wentTo = () => focus.mock.calls.map(([name, opts]) => `${name} ${JSON.stringify(opts)}`);

const highlighted = () => host.querySelector("button[data-i].bg-white\\/\\[0\\.06\\]")?.textContent;

it("opens on Ctrl+F, moves the highlight with the arrows, and goes only on Enter or a click", () => {
  expect(input()).toBeNull();
  key(window, { code: "KeyF", key: "f", ctrlKey: true });
  expect(input()).not.toBeNull();

  type("card");
  expect(rows()).toEqual(["PricingCard", "ProfileCard"]);
  act(() => vi.advanceTimersByTime(1000));
  expect(highlighted()).toBe("PricingCard");

  key(input()!, { key: "ArrowDown" });
  expect(highlighted()).toBe("ProfileCard");
  key(input()!, { key: "ArrowDown" });
  expect(highlighted()).toBe("PricingCard");
  key(input()!, { key: "ArrowUp" });
  expect(highlighted()).toBe("ProfileCard");
  expect(focus).not.toHaveBeenCalled();

  key(input()!, { key: "Enter" });
  act(() => host.querySelector<HTMLButtonElement>('button[data-i="0"]')!.click());
  expect(wentTo()).toEqual(['ProfileCard {"duration":0}', 'PricingCard {"duration":0}']);
});

it("closes on Escape and opens again with the last query", () => {
  key(window, { code: "KeyF", key: "f", ctrlKey: true });
  type("chf");
  expect(rows()).toEqual(["CheckoutForm"]);

  key(input()!, { key: "Escape" });
  expect(input()).toBeNull();

  key(window, { code: "KeyF", key: "f", ctrlKey: true });
  expect(input()!.value).toBe("chf");
  expect(rows()).toEqual(["CheckoutForm"]);
});

it("closes on a click outside it, not inside, and keeps the query", () => {
  const outside = document.body.appendChild(document.createElement("div"));
  const down = (target: Element) =>
    act(() => {
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
  key(window, { code: "KeyF", key: "f", ctrlKey: true });
  type("card");

  down(input()!);
  down(host.querySelector("button[data-i]")!);
  expect(input()).not.toBeNull();

  down(outside);
  expect(input()).toBeNull();

  key(window, { code: "KeyF", key: "f", ctrlKey: true });
  expect(input()!.value).toBe("card");
});

it("closes on a click into a frame, which only shows as the window's blur", () => {
  const frame = document.body.appendChild(document.createElement("iframe"));
  key(window, { code: "KeyF", key: "f", ctrlKey: true });

  act(() => {
    window.dispatchEvent(new Event("blur"));
    vi.runAllTimers();
  });
  expect(input()).not.toBeNull(); // the window left for another app: stays

  act(() => {
    frame.focus();
    window.dispatchEvent(new Event("blur"));
    vi.runAllTimers();
  });
  expect(input()).toBeNull();
});
