// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreviewWindow } from "../PreviewWindow";

// The workspace's components, as the components panel lists them.
const components = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("@/renderer/store/userComponents", () => ({
  useUserComponentsWatcher: () => {},
  useUserComponents: () => ({ data: components.names.map((name) => ({ name })) }),
}));

// A frame's own window: its component under a titlebar that names it, with
// the canvas's Pointer and Comment tools when it has a workspace.

const URL_ = "https://localhost:5300/preview?componentName=Card";
const WORKSPACE = "7d4a1b84-e8ea-4cfd-bb2a-48387ee73c04";

let root: Root;
let host: HTMLElement;

const open = async (workspaceId?: string, { url = URL_, onSwitch }: { url?: string; onSwitch?: (url: string) => void } = {}) => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
        <PreviewWindow url={url} workspaceId={workspaceId} onSwitch={onSwitch} />
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

it("gives the component the keys once it loads, and again after a Refresh", async () => {
  await open();
  host.querySelector("iframe")!.dispatchEvent(new Event("load"));
  expect(document.activeElement).toBe(host.querySelector("iframe"));
  const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
  await act(async () => refresh.click());
  refresh.focus();
  host.querySelector("iframe")!.dispatchEvent(new Event("load"));
  expect(document.activeElement).toBe(host.querySelector("iframe"));
});

it("steps to the workspace's component before or after this one, but not past either end", async () => {
  const onSwitch = vi.fn();
  const at = async (name: string) => {
    await open(WORKSPACE, { url: `https://localhost:5300/preview?componentName=${name}`, onSwitch });
    return (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label} component"]`)!;
  };
  components.names = ["Alert", "Card", "Dialog"];

  let step = await at("Card");
  act(() => step("Previous").click());
  act(() => step("Next").click());
  expect(onSwitch.mock.calls).toEqual([
    ["https://localhost:5300/preview?componentName=Alert"],
    ["https://localhost:5300/preview?componentName=Dialog"],
  ]);

  step = await at("Alert");
  expect([step("Previous").disabled, step("Next").disabled]).toEqual([true, false]);
  step = await at("Dialog");
  expect([step("Previous").disabled, step("Next").disabled]).toEqual([false, true]);
  // Gone from the workspace: nowhere to step from.
  step = await at("Badge");
  expect([step("Previous").disabled, step("Next").disabled]).toEqual([true, true]);
});

it("has no steps without a workspace", async () => {
  await open(undefined, { onSwitch: () => {} });
  expect(buttons()).toEqual(["Refresh"]);
});
