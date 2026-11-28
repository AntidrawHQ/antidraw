// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useOutsideAgent } from "../outside-agent";

// What the main window does with an agent's focus_component (main/mcp),
// which main checks against the canvas mirror: one sent before the tab was
// closed can let it through.

vi.mock("@/renderer/lib/api", () => ({ stopDevServer: vi.fn() }));

let focus: (name: string) => void = () => {};
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    mirrorCanvas: () => {},
    onOpenWorkspace: () => () => {},
    onFocusComponent: (callback: (name: string) => void) => {
      focus = callback;
      return () => {};
    },
  };
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  useWorkspaceStore.setState({ activeWorkspaceId: null, dashboardShown: false, focusComponentName: null });
});

const mount = () => {
  const Window = () => {
    useOutsideAgent();
    return null;
  };
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <Window />
      </QueryClientProvider>,
    ),
  );
};

const view = () => {
  const { activeWorkspaceId, dashboardShown, focusComponentName } = useWorkspaceStore.getState();
  return { activeWorkspaceId, dashboardShown, focusComponentName };
};

it("shows the component from under the dashboard, and does nothing once the tab is closed", () => {
  mount();
  const seen: Record<string, unknown> = {};

  act(() => useWorkspaceStore.setState({ activeWorkspaceId: "w-a", dashboardShown: true }));
  act(() => focus("Hero"));
  seen["under the dashboard"] = view();

  act(() => useWorkspaceStore.setState({ activeWorkspaceId: null, dashboardShown: true, focusComponentName: null }));
  act(() => focus("Hero"));
  seen["tab closed"] = view();

  expect(seen).toMatchInlineSnapshot(`
    {
      "tab closed": {
        "activeWorkspaceId": null,
        "dashboardShown": true,
        "focusComponentName": null,
      },
      "under the dashboard": {
        "activeWorkspaceId": "w-a",
        "dashboardShown": false,
        "focusComponentName": "Hero",
      },
    }
  `);
});
