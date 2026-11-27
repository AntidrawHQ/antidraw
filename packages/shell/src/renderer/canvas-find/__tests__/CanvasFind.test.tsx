// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// ⌘F (Ctrl+F here: jsdom isn't a Mac) opens the find. Typing and ↓ / ↑ only
// move the highlight; ↵ (or a click) goes to it, as a jump, not a flight.
// Esc, ×, or a click outside it, closes it and the query is kept.

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
  await render(COMPONENTS);
});

const render = (components: { name: string }[], keysOff = false) =>
  act(async () => root.render(<CanvasFind components={components} keysOff={keysOff} />));

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const input = () => host.querySelector("input");
const key = (target: EventTarget, init: KeyboardEventInit) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
// The canvas's hotkeys listen on the document.
const ctrlF = (init: KeyboardEventInit = {}) => key(document.body, { code: "KeyF", key: "f", ctrlKey: true, ...init });
const type = (text: string) =>
  act(() => {
    const el = input()!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const rows = () => [...host.querySelectorAll("button[data-i]")].map((b) => b.textContent);
const wentTo = () => focus.mock.calls.map(([name, opts]) => `${name} ${JSON.stringify(opts)}`);

const highlighted = () => host.querySelector("button[data-i].bg-white\\/\\[0\\.06\\]")?.textContent;
const bright = () => [...host.querySelectorAll("button[data-i] .text-\\[\\#f5f5f5\\]")].map((s) => s.textContent);

it("opens with the focus in the field and its text selected", () => {
  ctrlF();
  type("card");
  key(input()!, { key: "Escape" });
  ctrlF();
  expect(document.activeElement).toBe(input());
  expect([input()!.selectionStart, input()!.selectionEnd]).toEqual([0, 4]);
});

it("opens on Ctrl+F, moves the highlight with the arrows, and goes only on Enter or a click", () => {
  expect(input()).toBeNull();
  ctrlF();
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
  ctrlF();
  type("chf");
  expect(rows()).toEqual(["CheckoutForm"]);

  key(input()!, { key: "Escape" });
  expect(input()).toBeNull();

  ctrlF();
  expect(input()!.value).toBe("chf");
  expect(rows()).toEqual(["CheckoutForm"]);
});

it("closes on a click outside it, not inside, and keeps the query", () => {
  const outside = document.body.appendChild(document.createElement("div"));
  const down = (target: Element) =>
    act(() => {
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
  ctrlF();
  type("card");

  down(input()!);
  down(host.querySelector("button[data-i]")!);
  expect(input()).not.toBeNull();

  down(outside);
  expect(input()).toBeNull();

  ctrlF();
  expect(input()!.value).toBe("card");
});

it("closes on a click into a frame, which only shows as the window's blur", () => {
  const frame = document.body.appendChild(document.createElement("iframe"));
  ctrlF();

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

it("on Ctrl+F while open, puts the focus back in the field with its text selected", () => {
  ctrlF();
  type("card");
  const elsewhere = document.body.appendChild(document.createElement("input"));
  elsewhere.focus();

  key(elsewhere, { code: "KeyF", key: "f", ctrlKey: true });
  expect(document.activeElement).toBe(input());
  expect([input()!.selectionStart, input()!.selectionEnd]).toEqual([0, 4]);
});

it("opens on Ctrl+F only: not with Shift or Alt, not on Meta off a Mac, not under the dashboard", async () => {
  ctrlF({ shiftKey: true });
  ctrlF({ altKey: true });
  key(document.body, { code: "KeyF", key: "f", metaKey: true });
  key(document.body, { code: "KeyF", key: "f" });
  expect(input()).toBeNull();

  await render(COMPONENTS, true);
  ctrlF();
  expect(input()).toBeNull();
});

it("closes on the × and opens again with the last query", () => {
  ctrlF();
  type("card");
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  expect(input()).toBeNull();

  ctrlF();
  expect(input()!.value).toBe("card");
});

it("keeps the focus in the field through a press on a row, so its keys stay its own", () => {
  ctrlF();
  type("card");
  const row = host.querySelector("button[data-i]")!;
  const press = (target: Element) => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(down);
    });
    return down.defaultPrevented;
  };
  expect(press(row)).toBe(true); // the press doesn't move the focus
  expect(press(input()!)).toBe(false); // a press in the field still places the caret
});

it("leaves an Escape a popover already took, and an IME's Enter, alone", () => {
  ctrlF();
  type("card");
  const popover = (e: KeyboardEvent) => e.key === "Escape" && e.preventDefault();
  document.addEventListener("keydown", popover, true);
  key(input()!, { key: "Escape" });
  document.removeEventListener("keydown", popover, true);
  expect(input()).not.toBeNull();

  key(input()!, { key: "Enter", isComposing: true });
  expect(focus).not.toHaveBeenCalled();
});

it("keeps the highlight on the same component while the list changes under it", async () => {
  ctrlF();
  type("card");
  key(input()!, { key: "ArrowDown" });
  expect(highlighted()).toBe("ProfileCard");

  // A new match that sorts first: the highlight stays on ProfileCard.
  await render([{ name: "Card" }, ...COMPONENTS]);
  expect(rows()).toEqual(["Card", "PricingCard", "ProfileCard"]);
  expect(highlighted()).toBe("ProfileCard");

  // ProfileCard deleted: the first match, and Enter goes to it.
  await render(COMPONENTS.filter((c) => c.name !== "ProfileCard"));
  expect(highlighted()).toBe("PricingCard");
  key(input()!, { key: "Enter" });
  expect(wentTo()).toEqual(['PricingCard {"duration":0}']);
});

it("ranks substrings first, by where they start, and ignores spaces in the query and the name", async () => {
  await render(["CxaxrxD", "PricingCard", "Card", "ShowHeroSection", "Hero Section", "🔥Card"].map((name) => ({ name })));
  ctrlF();

  type("card");
  expect(rows()).toEqual(["Card", "🔥Card", "PricingCard", "CxaxrxD"]);
  expect(bright().slice(0, 2)).toEqual(["Card", "Card"]);

  await render(["X".repeat(120) + "Card", "CxxxAxxxRxxxD", "İkonButton"].map((name) => ({ name })));
  type("card");
  expect(rows()).toEqual(["X".repeat(120) + "Card", "CxxxAxxxRxxxD"]); // a substring first, however far in
  type("ikon");
  expect(rows()).toEqual(["İkonButton"]);
  expect(bright()).toEqual(["İkon"]);

  await render(["CxaxrxD", "PricingCard", "Card", "ShowHeroSection", "Hero Section", "🔥Card"].map((name) => ({ name })));
  type("hero section");
  expect(rows()).toEqual(["Hero Section", "ShowHeroSection"]);
  expect(bright().slice(0, 1)).toEqual(["Hero"]);
});

it("closes when its keys go off (the dashboard over the canvas, or no frames left), keeping the query", async () => {
  ctrlF();
  type("card");
  await render(COMPONENTS, true);
  expect(input()).toBeNull();
  await render(COMPONENTS);
  ctrlF();
  expect(input()!.value).toBe("card");

  // Closed already when they go off: the query it closed with stays.
  type("hero");
  key(input()!, { key: "Escape" });
  await render(COMPONENTS, true);
  await render(COMPONENTS);
  ctrlF();
  expect(input()!.value).toBe("hero");
});
