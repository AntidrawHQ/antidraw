// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ElementInfo } from "@/agent/protocol";
import type { Style } from "@/shared/design";
import type { EditList } from "@/shared/utils/canvas-edits";
import { queryKeys } from "@/renderer/lib/query-keys";
import { useInspectorStore } from "@/renderer/inspector/store";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useDesignStore } from "../store";

// The canvas's side of the panel: the selected element is read from its
// frame when there's no edit of it to start from, and again when what the
// frame shows of it may have changed.

const style = (gap: number) => ({ style: { gap } as Style, text: false });
const getStyle = vi.fn(async (): Promise<ReturnType<typeof style> | null> => style(8));

vi.mock("@/renderer/inspector/bridge", () => ({
  getStyle: () => getStyle(),
  getElementContext: async () => [null],
  previewStyles: () => {},
  frameUrl: () => null,
}));
vi.mock("@/renderer/lib/edit-ops", async (original) => ({
  ...(await original<typeof import("@/renderer/lib/edit-ops")>()),
  useEditsChanged: () => {},
}));

const { DesignSync } = await import("../use-design");

const WS = "8a3c2f00-0000-4000-8000-000000000002";
const info = { ref: { loc: "src/Card.tsx:3:5", index: 0, path: [0], tag: "div" }, tag: "div", id: "", classes: [] } as unknown as ElementInfo;
const other = { ...info, ref: { ...info.ref, loc: "src/Card.tsx:4:7" } } as ElementInfo;

let root: Root;
let client: QueryClient;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const edits = (list: EditList) => act(async () => void client.setQueryData(queryKeys.edits.byWorkspace(WS), list));

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  getStyle.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.edits.byWorkspace(WS), { edits: [], applied: [] } satisfies EditList);
  useWorkspaceStore.setState({ activeWorkspaceId: WS });
  useDesignStore.setState({ read: null });
  useInspectorStore.setState({ selection: { frame: "Card", info }, frames: {} });
  root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DesignSync />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => act(() => root.unmount()));

it("a reloaded frame is read once the component's element is there, not while the page's root stands in", async () => {
  useInspectorStore.getState().setFrame("Card", { ready: true, tagged: true, provisional: true });
  await settle();
  expect(getStyle).not.toHaveBeenCalled();

  useInspectorStore.getState().setFrame("Card", { ready: true, tagged: true });
  await settle();
  expect(getStyle).toHaveBeenCalledTimes(1);
  expect(useDesignStore.getState().read?.style.gap).toBe(8);

  // Gone and back, its element not found this time: what was read stays.
  getStyle.mockResolvedValueOnce(null);
  useInspectorStore.getState().setFrame("Card", { ready: false, tagged: true });
  await settle();
  useInspectorStore.getState().setFrame("Card", { ready: true, tagged: true });
  await settle();
  expect(getStyle).toHaveBeenCalledTimes(2);
  expect(useDesignStore.getState().read?.style.gap).toBe(8);
});

it("a set let go on the element's frame reads it again: the frame shows the code's now", async () => {
  useInspectorStore.getState().setFrame("Card", { ready: true, tagged: true });
  await settle();
  expect(getStyle).toHaveBeenCalledTimes(1);

  const applied = { id: 4, conversationId: "c", edits: [{ id: 9, componentName: "Card", element: other, name: "div", text: false, base: {} as Style, now: {} as Style, seen: null }] };
  await edits({ edits: [], applied: [applied] });
  await settle();
  expect(getStyle).toHaveBeenCalledTimes(2);

  getStyle.mockResolvedValueOnce(style(16));
  await edits({ edits: [], applied: [] });
  await settle();
  expect(getStyle).toHaveBeenCalledTimes(3);
  expect(useDesignStore.getState().read?.style.gap).toBe(16);
});
