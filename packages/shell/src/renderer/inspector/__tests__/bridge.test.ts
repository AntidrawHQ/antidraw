// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { INSPECTOR_NS, type ElementInfo, type FromFrame } from "@antidrawapp/runtime/inspector";
import { clearHover, hoverAt, registerFrame, selectAt } from "../bridge";
import { useInspectorStore } from "../store";
import { describeTag, takeTags } from "../tags";

// The canvas side of the inspector, against a frame played by the test: what
// it asks, and which answers it believes.

const ORIGIN = "https://frame.test";
const OWN = "src/components/user-components/Card.tsx";

const info = (over: Partial<ElementInfo> = {}): ElementInfo => ({
  ref: { loc: `${OWN}:4:7`, index: 0, path: [0, 0], tag: "h3" },
  callsite: `${OWN}:4:7`,
  tag: "h3",
  id: "",
  classes: ["title"],
  text: "Pro plan",
  rect: { x: 10, y: 20, width: 100, height: 24 },
  margin: [0, 0, 0, 0],
  border: [0, 0, 0, 0],
  padding: [0, 0, 0, 0],
  ...over,
});

let iframe: HTMLIFrameElement;
let unregister: () => void;
let asked: { msg: Record<string, unknown>; origin: string }[];

const frameSays = (msg: FromFrame, { origin = ORIGIN, source = iframe.contentWindow } = {}) =>
  window.dispatchEvent(new MessageEvent("message", { data: { ns: INSPECTOR_NS, ...msg }, origin, source }));
const lastAsked = () => asked.at(-1)!.msg as { type: string; id: number };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useInspectorStore.setState({ active: true, frames: {}, hover: null, selection: null, tags: [] });
  iframe = document.createElement("iframe");
  iframe.src = `${ORIGIN}/preview?componentName=Card`;
  document.body.append(iframe);
  asked = [];
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(((msg: Record<string, unknown>, origin: string) => {
    asked.push({ msg, origin });
  }) as Window["postMessage"]);
  unregister = registerFrame("Card", iframe);
});

afterEach(() => {
  unregister();
  iframe.remove();
  vi.restoreAllMocks();
});

it("says hello to the frame's origin, and believes only that frame from that origin", () => {
  expect(asked).toEqual([{ msg: { ns: INSPECTOR_NS, type: "hello", id: expect.any(Number) }, origin: ORIGIN }]);
  const ready = { type: "ready", protocol: 1, componentName: "Card", tagged: true } as const;
  frameSays(ready, { origin: "https://elsewhere.test" });
  frameSays(ready, { source: window });
  expect(useInspectorStore.getState().frames).toEqual({});
  frameSays(ready);
  expect(useInspectorStore.getState().frames).toEqual({ Card: { ready: true, tagged: true } });
  frameSays({ ...ready, protocol: 2 });
  unregister();
  expect(useInspectorStore.getState().frames).toEqual({});
});

it("hovers what the frame answers, and drops answers to an older question", async () => {
  const first = hoverAt("Card", 5, 6);
  const firstId = lastAsked().id;
  expect(lastAsked()).toMatchObject({ type: "hit", x: 5, y: 6 });
  const second = hoverAt("Card", 7, 8);
  const secondId = lastAsked().id;
  frameSays({ type: "hover", id: secondId, info: info({ text: "new" }) });
  frameSays({ type: "hover", id: firstId, info: info({ text: "old" }) });
  await Promise.all([first, second]);
  expect(useInspectorStore.getState().hover?.info.text).toBe("new");

  const third = hoverAt("Card", 1, 1);
  const thirdId = lastAsked().id;
  clearHover("Card");
  frameSays({ type: "hover", id: thirdId, info: info({ text: "late" }) });
  await third;
  expect(useInspectorStore.getState().hover).toBeNull();
});

it("follows the selection the frame reports, and gives it back after a reload", async () => {
  const selecting = selectAt("Card", 5, 6);
  frameSays({ type: "selected", id: lastAsked().id, info: info() });
  await selecting;
  frameSays({ type: "selection-changed", info: info({ ref: { loc: `${OWN}:6:7`, index: 0, path: [0, 0], tag: "h3" } }) });
  expect(useInspectorStore.getState().selection?.info.ref.loc).toBe(`${OWN}:6:7`);

  frameSays({ type: "ready", protocol: 1, componentName: "Card", tagged: true });
  expect(lastAsked()).toMatchObject({ type: "select", ref: { loc: `${OWN}:6:7` } });

  frameSays({ type: "selection-lost" });
  expect(useInspectorStore.getState().selection).toBeNull();
});

it("sends tags as the frame sees them now, keeping the old description if it can't say", async () => {
  const moved = { frame: "Card", info: info() };
  const gone = { frame: "Card", info: info({ tag: "p", classes: [], ref: { loc: `${OWN}:9:7`, index: 0, path: [3], tag: "p" } }) };
  useInspectorStore.setState({ tags: [moved, gone] });
  const taking = takeTags();
  expect(useInspectorStore.getState().tags).toEqual([]);
  expect(lastAsked()).toMatchObject({ type: "resolve", refs: [moved.info.ref, gone.info.ref] });
  frameSays({ type: "resolved", id: lastAsked().id, infos: [info({ ref: { loc: `${OWN}:5:7`, index: 0, path: [0, 0], tag: "h3" } }), null] });
  await settle();
  expect(await taking).toMatchInlineSnapshot(`
    "<canvas-selection>
    <element component="Card" loc="src/components/user-components/Card.tsx:5:7" callsite="src/components/user-components/Card.tsx:4:7" element="h3.title" text="Pro plan" />
    <element component="Card" loc="src/components/user-components/Card.tsx:9:7" callsite="src/components/user-components/Card.tsx:4:7" element="p" text="Pro plan" />
    </canvas-selection>"
  `);
});

it("describes an element without a source location by its path, escaped", () => {
  expect(
    describeTag({
      frame: "Card",
      info: info({ ref: { loc: null, index: 0, path: [0, 2], tag: "h3" }, callsite: null, id: "cta", text: 'Say "hi" & <go>' }),
    }),
  ).toBe('<element component="Card" element="h3#cta.title" text="Say &quot;hi&quot; &amp; &lt;go>" path="0/2" />');
});
