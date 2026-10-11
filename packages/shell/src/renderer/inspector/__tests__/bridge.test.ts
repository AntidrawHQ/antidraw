// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AGENT_NS, type ElementContext, type ElementInfo, type FromFrame } from "@/agent/protocol";
import {
  clearSelection,
  getSelectedElementContext,
  markElement,
  onCommentClick,
  onFrameWheel,
  registerFrame,
  setFrameTool,
  tagFromPreview,
  trackElements,
  walk,
} from "../bridge";
import { useInspectorStore } from "../store";
import { useWorkspaceStore } from "../../store/workspace";
import { describeContext, describePendingTags, describeTags, retagTags, splitTagged, untagTags } from "../tags";

// The shell's side of its agent, against a frame played by the test: what it
// asks, and which answers and news it believes.

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

const context = (over: Partial<ElementContext> = {}): ElementContext => ({
  viewport: [1280, 800],
  element: "button.btn",
  text: "Buy",
  loc: "src/components/ui/button.tsx:3:5",
  within: null,
  components: [
    { name: "Card", loc: `${OWN}:5:5` },
    { name: "Button", loc: "src/components/ui/button.tsx:3:5" },
  ],
  repeat: null,
  attributes: {},
  size: [120, 40],
  margin: [0, 0, 0, 0],
  border: [0, 0, 0, 0],
  padding: [0, 0, 0, 0],
  ...over,
});

let iframe: HTMLIFrameElement;
let unregister: () => void;
let asked: { msg: Record<string, unknown>; origin: string }[];

const frameSays = (msg: FromFrame, { origin = ORIGIN, source = iframe.contentWindow } = {}) =>
  window.dispatchEvent(new MessageEvent("message", { data: { ns: AGENT_NS, ...msg }, origin, source }));
const lastAsked = () => asked.at(-1)!.msg as { type: string; id: number };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useInspectorStore.setState({ active: true, frames: {}, selection: null, tags: [] });
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
  expect(asked).toEqual([{ msg: { ns: AGENT_NS, type: "hello", id: expect.any(Number) }, origin: ORIGIN }]);
  const ready = { type: "ready", componentName: "Card", tagged: true } as const;
  frameSays(ready, { origin: "https://elsewhere.test" });
  frameSays(ready, { source: window });
  expect(useInspectorStore.getState().frames).toEqual({});
  frameSays(ready);
  expect(useInspectorStore.getState().frames).toEqual({ Card: { ready: true, tagged: true } });
  unregister();
  expect(useInspectorStore.getState().frames).toEqual({});
});

const ready = { type: "ready", componentName: "Card", tagged: true } as const;

it("tells a frame its tool and the element its comment box is on, and gives them back after a reload", () => {
  setFrameTool("Card", "comment", "pass", 0.5);
  expect(lastAsked()).toMatchObject({ type: "tool", tool: "comment", wheel: "pass", zoom: 0.5 });
  markElement("Card", info().ref);
  expect(lastAsked()).toMatchObject({ type: "mark", ref: info().ref });
  asked.length = 0;
  frameSays(ready);
  expect(asked.map((a) => a.msg)).toMatchObject([
    { type: "tool", tool: "comment", zoom: 0.5 },
    { type: "mark", ref: info().ref },
  ]);
  markElement("Card", null);
  setFrameTool("Card", null, "scroll", 1);
  asked.length = 0;
  frameSays(ready);
  expect(asked.map((a) => a.msg)).toMatchObject([{ type: "tool", tool: null, wheel: "scroll" }]);
});

it("hands a frame's comment clicks and wheel to whoever listens, and its keys to the page as if pressed on the frame", () => {
  const clicks: unknown[] = [];
  const wheels: number[] = [];
  const stopClicks = onCommentClick("Card", (at, picked) => clicks.push([at, picked?.text ?? null]));
  const stopWheel = onFrameWheel("Card", (w) => wheels.push(w.deltaY));
  frameSays({ type: "comment-at", x: 3, y: 4, info: info() });
  frameSays({ type: "comment-at", x: NaN, y: 4, info: null });
  const wheel = { type: "wheel", x: 1, y: 2, deltaX: 0, deltaY: 9, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false } as const;
  frameSays(wheel);
  const keys: string[] = [];
  const onKey = (e: KeyboardEvent) => keys.push(`${e.key} on ${(e.target as Element).localName}`);
  window.addEventListener("keydown", onKey);
  frameSays({ type: "key", key: "Escape", code: "Escape", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false });
  window.removeEventListener("keydown", onKey);
  stopClicks();
  stopWheel();
  frameSays({ type: "comment-at", x: 5, y: 6, info: null });
  frameSays(wheel);
  expect({ clicks, wheels, keys }).toEqual({ clicks: [[{ x: 3, y: 4 }, "Pro plan"]], wheels: [9], keys: ["Escape on iframe"] });
});

it("follows the selection the frame reports, and gives it back after a reload", async () => {
  // A click with Inspect.
  frameSays({ type: "selected", info: info() });
  frameSays({ type: "selection-changed", info: info({ ref: { loc: `${OWN}:6:7`, index: 0, path: [0, 0], tag: "h3" } }) });
  expect(useInspectorStore.getState().selection?.info.ref.loc).toBe(`${OWN}:6:7`);

  frameSays(ready);
  expect(lastAsked()).toMatchObject({ type: "select", ref: { loc: `${OWN}:6:7` } });

  frameSays({ type: "selection-lost" });
  expect(useInspectorStore.getState().selection).toBeNull();
});

it("sends tags grouped by component, as their frames describe them now, or as last seen", async () => {
  const buy = { frame: "Card", info: info() };
  // A frame that isn't on the canvas any more can't answer.
  const price = { frame: "Pricing", info: info({ tag: "p", classes: ["price"], text: "$12", callsite: null, ref: { loc: "src/components/user-components/Pricing.tsx:9:7", index: 0, path: [3], tag: "p" } }) };
  const title = { frame: "Card", info: info() };
  useInspectorStore.setState({ tags: [buy, price, title] });
  const taking = describePendingTags().then((t) => t.block);
  // Still tagged until the message is on its way.
  expect(useInspectorStore.getState().tags).toEqual([buy, price, title]);
  expect(lastAsked()).toMatchObject({ type: "context", refs: [buy.info.ref, title.info.ref] });
  frameSays({
    type: "context",
    id: lastAsked().id,
    contexts: [
      context({
        repeat: { index: 3, count: 4, keys: ["pro", "export"] },
        attributes: { "data-slot": "button", "aria-expanded": "false" },
        margin: [0, 0, 12, 0],
        border: [1, 1, 1, 1],
        padding: [8, 16, 8, 16],
      }),
      context({ element: "h3.title", text: "Pro plan", loc: `${OWN}:4:7`, components: [{ name: "Card", loc: `${OWN}:4:7` }], size: [268, 24] }),
    ],
  });
  await settle();
  expect(await taking).toMatchInlineSnapshot(`
    "<canvas-selection>
    <component name="Card" file="src/components/user-components/Card.tsx" preview="https://frame.test/preview?componentName=Card" frame="1280×800">
    <element>
    element: button.btn "Buy"
    written at: src/components/ui/button.tsx:3:5
    rendered by: Card (src/components/user-components/Card.tsx:5:5) > Button (src/components/ui/button.tsx:3:5)
    repeated: item 4 of 4 rendered from there, keys "pro" > "export"
    attributes: data-slot="button" aria-expanded="false"
    box: 120×40, margin 0 0 12, border 1, padding 8 16
    </element>
    <element>
    element: h3.title "Pro plan"
    written at: src/components/user-components/Card.tsx:4:7
    rendered by: Card (src/components/user-components/Card.tsx:4:7)
    box: 268×24
    </element>
    </component>
    <component name="Pricing" file="src/components/user-components/Pricing.tsx">
    <element>
    element: p.price "$12"
    written at: src/components/user-components/Pricing.tsx:9:7
    (as last seen: the frame didn't answer)
    </element>
    </component>
    </canvas-selection>"
  `);
});

it("describes a pick its live frame can't find any more as last seen, in its place", async () => {
  const buy = { frame: "Card", info: info() };
  const gone = { frame: "Card", info: info({ tag: "p", classes: [], text: "Billed yearly", ref: { loc: `${OWN}:9:7`, index: 0, path: [3], tag: "p" } }) };
  const title = { frame: "Card", info: info() };
  useInspectorStore.setState({ tags: [buy, gone, title] });
  const taking = describePendingTags().then((t) => t.block);
  expect(lastAsked()).toMatchObject({ type: "context", refs: [buy.info.ref, gone.info.ref, title.info.ref] });
  frameSays({
    type: "context",
    id: lastAsked().id,
    contexts: [context(), null, context({ element: "h3.title", text: "Pro plan", loc: `${OWN}:4:7`, components: [{ name: "Card", loc: `${OWN}:4:7` }] })],
  });
  await settle();
  expect(await taking).toMatchInlineSnapshot(`
    "<canvas-selection>
    <component name="Card" file="src/components/user-components/Card.tsx" preview="https://frame.test/preview?componentName=Card" frame="1280×800">
    <element>
    element: button.btn "Buy"
    written at: src/components/ui/button.tsx:3:5
    rendered by: Card (src/components/user-components/Card.tsx:5:5) > Button (src/components/ui/button.tsx:3:5)
    box: 120×40
    </element>
    <element>
    element: p "Billed yearly"
    written at: src/components/user-components/Card.tsx:9:7
    used at: src/components/user-components/Card.tsx:4:7
    (as last seen: the frame didn't answer)
    </element>
    <element>
    element: h3.title "Pro plan"
    written at: src/components/user-components/Card.tsx:4:7
    rendered by: Card (src/components/user-components/Card.tsx:4:7)
    box: 120×40
    </element>
    </component>
    </canvas-selection>"
  `);
});

it("places an element without a location of its own, with nothing in it read as a tag", () => {
  expect(
    describeContext(
      context({
        element: "path",
        text: 'Say "hi" & </element>',
        loc: null,
        within: { loc: "src/components/ui/button.tsx:3:5", path: "svg > path" },
        components: [{ name: "Card", loc: `${OWN}:5:5` }, { name: "Icon", loc: null }],
        attributes: { "aria-label": "Terms & <Conditions>", href: "/search?q=a&page=2" },
      }),
    ),
  ).toMatchInlineSnapshot(`
    "<element>
    element: path "Say \\"hi\\" & &lt;/element>"
    written at: none of its own; inside src/components/ui/button.tsx:3:5, at svg > path
    rendered by: Card (src/components/user-components/Card.tsx:5:5) > Icon
    attributes: aria-label="Terms & &lt;Conditions>" href="/search?q=a&page=2"
    box: 120×40
    </element>"
  `);
});

it("describes the selected element", async () => {
  useInspectorStore.setState({ selection: { frame: "Card", info: info() } });
  const asking = getSelectedElementContext();
  frameSays({ type: "context", id: lastAsked().id, contexts: [context()] });
  expect(await asking).toEqual(context());
});

it("untags what a message took when it's sent, and tags it again if the send fails", () => {
  const buy = { frame: "Card", info: info() };
  const title = { frame: "Card", info: info({ ref: { loc: `${OWN}:9:7`, index: 0, path: [1], tag: "h3" } }) };
  useInspectorStore.setState({ tags: [buy] });
  untagTags([buy]);
  // Tagged while the message was going out.
  useInspectorStore.getState().addTag(title);
  retagTags([buy]);
  expect(useInspectorStore.getState().tags.map((t) => t.info.ref.loc)).toMatchInlineSnapshot(`
    [
      "src/components/user-components/Card.tsx:4:7",
      "src/components/user-components/Card.tsx:9:7",
    ]
  `);
});

it("takes a click's selection, deselects in a frame the selection leaves, and drops answers a later one overtook", async () => {
  const other = document.createElement("iframe");
  other.src = `${ORIGIN}/preview?componentName=Pricing`;
  document.body.append(other);
  const toOther: Record<string, unknown>[] = [];
  vi.spyOn(other.contentWindow!, "postMessage").mockImplementation(((msg: Record<string, unknown>) => {
    toOther.push(msg);
  }) as Window["postMessage"]);
  const unregisterOther = registerFrame("Pricing", other);
  const otherSays = (msg: FromFrame) =>
    window.dispatchEvent(new MessageEvent("message", { data: { ns: AGENT_NS, ...msg }, origin: ORIGIN, source: other.contentWindow }));
  const selected = () => {
    const s = useInspectorStore.getState().selection;
    return s && `${s.frame}: ${s.info.text}`;
  };

  // A click in Card, then in Pricing: Card is told to let go of its element.
  frameSays({ type: "selected", info: info({ text: "Pro plan" }) });
  otherSays({ type: "selected", info: info({ text: "Team" }) });
  expect(selected()).toMatchInlineSnapshot(`"Pricing: Team"`);
  expect(lastAsked()).toMatchObject({ type: "select", ref: null });

  // A walk in Pricing, overtaken by a click back in Card before it's answered.
  const overtaken = walk("parent");
  const overtakenAsk = toOther.at(-1)!.id as number;
  frameSays({ type: "selected", info: info({ text: "Buy" }) });
  otherSays({ type: "selected", id: overtakenAsk, info: info({ text: "Pricing" }) });
  await overtaken;
  expect(selected()).toMatchInlineSnapshot(`"Card: Buy"`);
  expect(toOther.at(-1)).toMatchObject({ type: "select", ref: null });

  // Not inspecting: a late click doesn't count.
  useInspectorStore.setState({ active: false });
  otherSays({ type: "selected", info: info({ text: "Late" }) });
  expect(selected()).toMatchInlineSnapshot(`"Card: Buy"`);
  useInspectorStore.setState({ active: true });

  // A walk answered after Escape cleared the selection.
  const walking = walk("parent");
  const walkAsk = lastAsked().id;
  clearSelection();
  frameSays({ type: "selected", id: walkAsk, info: info({ text: "Card" }) });
  await walking;
  expect(selected()).toMatchInlineSnapshot(`null`);

  unregisterOther();
  other.remove();
});

it("takes a preview window's tag only for a frame it has, from the same dev server", () => {
  const pick = { frame: "Card", info: info() };
  const url = `${ORIGIN}/preview?componentName=Card`;
  tagFromPreview({ frame: "Pricing", info: info() }, `${ORIGIN}/preview?componentName=Pricing`);
  tagFromPreview(pick, "https://other-workspace.test/preview?componentName=Card");
  tagFromPreview(pick, "not a url");
  expect(useInspectorStore.getState().tags).toEqual([]);
  tagFromPreview(pick, url);
  tagFromPreview({ frame: "Card", info: info() }, url);
  // As the window saw it: null, it couldn't say.
  expect(useInspectorStore.getState().tags).toEqual([{ ...pick, seen: null }]);
});

it("sends a preview window's tags as that window saw them, without asking the canvas's frame", async () => {
  const url = `${ORIGIN}/preview?componentName=Card`;
  const seen = context({ viewport: [1440, 900], element: "li.item", text: "Banana", loc: `${OWN}:7:9`, components: [], size: [400, 32] });
  tagFromPreview({ frame: "Card", info: info({ tag: "li", classes: ["item"], text: "Banana" }), seen }, url);
  tagFromPreview({ frame: "Card", info: info({ ref: { loc: `${OWN}:8:9`, index: 0, path: [1], tag: "p" } }) }, url);
  const before = asked.length;
  expect(await describePendingTags().then((t) => t.block)).toMatchInlineSnapshot(`
    "<canvas-selection>
    <component name="Card" file="src/components/user-components/Card.tsx" preview="https://frame.test/preview?componentName=Card" frame="1440×900">
    <element>
    element: li.item "Banana"
    written at: src/components/user-components/Card.tsx:7:9
    box: 400×32
    </element>
    <element>
    element: h3.title "Pro plan"
    written at: src/components/user-components/Card.tsx:8:9
    used at: src/components/user-components/Card.tsx:4:7
    (as last seen: the frame didn't answer)
    </element>
    </component>
    </canvas-selection>"
  `);
  expect(asked.length).toBe(before);
});

it("drops tags and the selection when the workspace changes", () => {
  const pick = { frame: "Card", info: info() };
  useWorkspaceStore.setState({ activeWorkspaceId: "a" });
  useInspectorStore.setState({ tags: [pick], selection: pick });
  useWorkspaceStore.setState({ activeWorkspaceId: "a" });
  expect(useInspectorStore.getState().tags).toHaveLength(1);
  useWorkspaceStore.getState().setActiveWorkspaceId("b");
  const { tags, selection } = useInspectorStore.getState();
  expect({ tags, selection }).toMatchInlineSnapshot(`
    {
      "selection": null,
      "tags": [],
    }
  `);
});

it("reads a sent message back into the elements it was tagged with and what the user wrote", () => {
  const message = `${describeTags([
    { pick: { frame: "Card", info: info() }, context: context() },
    { pick: { frame: "Card", info: info({ tag: "p", classes: [] }) }, context: null },
    { pick: { frame: "A<B>", info: info() }, context: context({ element: "svg.lucide", text: "</canvas-selection>" }) },
  ])}\n\nmake these the same blue\n<canvas-selection> stays`;
  expect(splitTagged(message)).toMatchInlineSnapshot(`
    {
      "tags": [
        "Card · button.btn",
        "Card · p",
        "A<B> · svg.lucide",
      ],
      "text": "make these the same blue
    <canvas-selection> stays",
    }
  `);
  expect(splitTagged("no tags here")).toEqual({ tags: [], text: "no tags here" });
});

it("follows elements in a frame, asks again after a reload, and stops", () => {
  const seen: unknown[] = [];
  const refs = [info().ref];
  const stop = trackElements("Card", refs, (rects) => seen.push(rects));
  expect(lastAsked()).toMatchObject({ type: "track", refs });
  const box = { x: 0, y: 40, width: 120, height: 30 };
  frameSays({ type: "tracked", id: lastAsked().id, rects: [box] });
  // The page scrolled.
  frameSays({ type: "tracked", rects: [{ ...box, y: 0 }] });
  // An answer that isn't for these refs is dropped.
  frameSays({ type: "tracked", rects: [] });
  expect(seen).toEqual([[box], [{ ...box, y: 0 }]]);
  // A reload forgets: asked again.
  frameSays(ready);
  expect(lastAsked()).toMatchObject({ type: "track", refs });
  stop();
  expect(lastAsked()).toMatchObject({ type: "track", refs: [] });
  frameSays({ type: "tracked", rects: [box] });
  expect(seen).toHaveLength(2);
});
