// @vitest-environment jsdom
import fc from "fast-check";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AGENT_NS, type ElementRef, type FromFrame, type Tool, type WheelMode } from "@/agent/protocol";
import { markElement, registerFrame, setFrameTool } from "../bridge";
import { useInspectorStore } from "../store";

// A frame's page reloads whenever it likes (an edit, Vite's full reload), and
// the new page's agent knows nothing. Whatever the shell set meanwhile, and in
// whatever order, once the new agent is ready the frame has the shell's
// latest tool and marked element, and the shell takes it as ready.

const ORIGIN = "https://frame.test";
let iframe: HTMLIFrameElement;
let unregister: () => void;
let deliver: (msg: Record<string, unknown>) => void;

beforeEach(() => {
  useInspectorStore.setState({ active: true, frames: {}, selection: null, tags: [] });
  iframe = document.createElement("iframe");
  iframe.src = `${ORIGIN}/preview?componentName=Card`;
  document.body.append(iframe);
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(((msg: Record<string, unknown>) =>
    deliver(msg)) as Window["postMessage"]);
  deliver = () => {};
  unregister = registerFrame("Card", iframe);
});

afterEach(() => {
  unregister();
  iframe.remove();
  vi.restoreAllMocks();
});

const frameSays = (msg: FromFrame) =>
  window.dispatchEvent(new MessageEvent("message", { data: { ns: AGENT_NS, ...msg }, origin: ORIGIN, source: iframe.contentWindow }));

const ref = fc.record({
  loc: fc.constantFrom("Card.tsx:1:1", "Card.tsx:2:3", null),
  index: fc.nat(3),
  path: fc.array(fc.nat(4), { maxLength: 3 }),
  tag: fc.constantFrom("div", "p"),
});
const action = fc.oneof(
  fc.record({
    kind: fc.constant("tool" as const),
    tool: fc.constantFrom<Tool | null>("inspect", "comment", null),
    wheel: fc.constantFrom<WheelMode>("pass", "scroll"),
    zoom: fc.constantFrom(0.5, 1, 2),
  }),
  fc.record({ kind: fc.constant("mark" as const), ref: fc.option(ref, { nil: null }) }),
  fc.constant({ kind: "gone" as const }),
  fc.constant({ kind: "ready" as const }),
);

it("gives a reloaded frame the shell's latest tool and mark", () => {
  fc.assert(
    fc.property(fc.array(action, { maxLength: 30 }), (actions) => {
      // The page's agent: what it has, while it's there to hear it.
      let alive = true;
      let page: { tool: Tool | null; wheel?: WheelMode; zoom?: number; mark: ElementRef | null } = { tool: null, mark: null };
      deliver = (msg) => {
        if (!alive) return;
        if (msg.type === "tool") page = { ...page, tool: msg.tool as Tool | null, wheel: msg.wheel as WheelMode, zoom: msg.zoom as number };
        if (msg.type === "mark") page = { ...page, mark: msg.ref as ElementRef | null };
      };
      setFrameTool("Card", null, "pass", 1);
      markElement("Card", null);
      frameSays({ type: "ready", componentName: "Card", tagged: true });
      // The shell's latest.
      let shell: typeof page = { tool: null, wheel: "pass", zoom: 1, mark: null };
      for (const a of actions) {
        if (a.kind === "tool") {
          setFrameTool("Card", a.tool, a.wheel, a.zoom);
          shell = { ...shell, tool: a.tool, wheel: a.wheel, zoom: a.zoom };
        } else if (a.kind === "mark") {
          markElement("Card", a.ref);
          shell = { ...shell, mark: a.ref };
        } else if (a.kind === "gone") {
          frameSays({ type: "gone" });
          alive = false;
          expect(useInspectorStore.getState().frames.Card?.ready).toBe(false);
        } else {
          // A new page, and its agent, which starts with nothing.
          alive = true;
          page = { tool: null, mark: null };
          frameSays({ type: "ready", componentName: "Card", tagged: true });
          expect(useInspectorStore.getState().frames.Card?.ready).toBe(true);
          expect(page.tool).toBe(shell.tool);
          expect(page.mark).toEqual(shell.mark);
          if (shell.tool) expect([page.wheel, page.zoom]).toEqual([shell.wheel, shell.zoom]);
        }
      }
    }),
    { numRuns: 300 },
  );
});
