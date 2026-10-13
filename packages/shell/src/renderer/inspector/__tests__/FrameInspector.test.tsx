// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ElementInfo } from "@/agent/protocol";
import { setCanvasTool, useCommentStore } from "@/renderer/comments/store";
import { useInspectorStore } from "../store";

// Which frames hear the canvas's zoom while a tool is on: only the one that
// draws an outline, and only once the zoom has settled.

const sent = vi.hoisted(() => [] as { frame: string; tool: string | null; zoom: number }[]);
vi.mock("../bridge", () => ({
  registerFrame: () => () => {},
  onFrameWheel: () => () => {},
  setFrameTool: (frame: string, tool: string | null, _wheel: string, zoom: number) => sent.push({ frame, tool, zoom }),
}));
const { renderFrameInspector } = await import("../FrameInspector");

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
let flow: ReturnType<typeof useStoreApi>;
const Grab = () => {
  flow = useStoreApi();
  return null;
};
const zoomTo = (z: number) => act(() => flow.setState({ transform: [0, 0, z] }));
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const to = (frame: string) => sent.filter((m) => m.frame === frame);

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  sent.length = 0;
  useInspectorStore.setState({
    frames: { A: { ready: true, tagged: true }, B: { ready: true, tagged: true }, C: { ready: true, tagged: true } },
    selection: null,
  });
  act(() => setCanvasTool("inspect"));
  document.body.innerHTML = `<div id="root"></div>`;
  root = createRoot(document.getElementById("root")!);
  await act(async () =>
    root.render(
      <ReactFlowProvider>
        <Grab />
        {["A", "B", "C"].map((frame) => (
          <div key={frame}>{renderFrameInspector({ componentName: frame, iframe: null })}</div>
        ))}
      </ReactFlowProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  act(() => setCanvasTool("pointer"));
  useInspectorStore.setState({ frames: {}, selection: null });
  useCommentStore.setState({ box: null });
  vi.useRealTimers();
});

it("tells every frame the tool once, and none of them each step of a zoom", async () => {
  expect(sent.map((m) => m.frame).sort()).toEqual(["A", "B", "C"]);
  expect(sent.every((m) => m.tool === "inspect" && m.zoom === 1)).toBe(true);
  sent.length = 0;
  for (const z of [1.1, 1.2, 1.3, 1.4, 1.5]) {
    zoomTo(z);
    await wait(16);
  }
  await wait(1000);
  expect(sent).toEqual([]);
});

it("tells the frame with the selection the zoom once it has settled, and only that frame", async () => {
  act(() => useInspectorStore.setState({ selection: { frame: "B", info } }));
  sent.length = 0;
  for (const z of [1.1, 1.2, 1.3, 1.4, 1.5]) {
    zoomTo(z);
    await wait(16);
  }
  expect(sent).toEqual([]);
  await wait(200);
  expect(sent).toEqual([{ frame: "B", tool: "inspect", zoom: 1.5 }]);
  expect(to("A")).toEqual([]);
  expect(to("C")).toEqual([]);
});

it("hands the zoom on with the selection, and to the frame a comment box is open on", async () => {
  zoomTo(2);
  await wait(500);
  act(() => useInspectorStore.setState({ selection: { frame: "A", info } }));
  expect(to("A").at(-1)).toEqual({ frame: "A", tool: "inspect", zoom: 2 });
  sent.length = 0;
  // The selection moves to C: A goes back to no zoom, C takes the canvas's.
  act(() => useInspectorStore.setState({ selection: { frame: "C", info } }));
  expect(to("A")).toEqual([{ frame: "A", tool: "inspect", zoom: 1 }]);
  expect(to("C")).toEqual([{ frame: "C", tool: "inspect", zoom: 2 }]);
  sent.length = 0;
  act(() => setCanvasTool("comment"));
  act(() => useCommentStore.setState({ box: { frame: "A", pos: { x: 0, y: 0 }, element: info } }));
  expect(to("A").at(-1)).toEqual({ frame: "A", tool: "comment", zoom: 2 });
});
