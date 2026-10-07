// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { INSPECTOR_NS, type ElementContext, type ElementInfo, type FromFrame } from "@antidrawapp/runtime/inspector";
import { clearHover, clearSelection, getSelectedElementContext, hoverAt, registerFrame, selectAt, walk } from "../bridge";
import { useInspectorStore } from "../store";
import { useWorkspaceStore } from "../../store/workspace";
import { describeContext, describePendingTags, retagTags, untagTags } from "../tags";

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

it("takes only the latest selection's answer, and deselects in a frame the selection leaves", async () => {
  const other = document.createElement("iframe");
  other.src = `${ORIGIN}/preview?componentName=Pricing`;
  document.body.append(other);
  const toOther: Record<string, unknown>[] = [];
  vi.spyOn(other.contentWindow!, "postMessage").mockImplementation(((msg: Record<string, unknown>) => {
    toOther.push(msg);
  }) as Window["postMessage"]);
  const unregisterOther = registerFrame("Pricing", other);
  const otherSays = (msg: FromFrame) =>
    window.dispatchEvent(new MessageEvent("message", { data: { ns: INSPECTOR_NS, ...msg }, origin: ORIGIN, source: other.contentWindow }));
  const selected = () => {
    const s = useInspectorStore.getState().selection;
    return s && `${s.frame}: ${s.info.text}`;
  };

  // A click in Card, then in Pricing; Card, busy, answers last.
  const inCard = selectAt("Card", 1, 1);
  const cardAsk = lastAsked().id;
  const inPricing = selectAt("Pricing", 1, 1);
  otherSays({ type: "selected", id: toOther.at(-1)!.id as number, info: info({ text: "Team" }) });
  frameSays({ type: "selected", id: cardAsk, info: info({ text: "Pro plan" }) });
  await Promise.all([inCard, inPricing]);
  expect(selected()).toMatchInlineSnapshot(`"Pricing: Team"`);

  // Back to Card: Pricing is told to let go of its element.
  const back = selectAt("Card", 2, 2);
  frameSays({ type: "selected", id: lastAsked().id, info: info({ text: "Buy" }) });
  await back;
  expect(selected()).toMatchInlineSnapshot(`"Card: Buy"`);
  expect(toOther.at(-1)).toMatchObject({ type: "select", ref: null });

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

it("drops tags, the selection and the hover when the workspace changes", () => {
  const pick = { frame: "Card", info: info() };
  useWorkspaceStore.setState({ activeWorkspaceId: "a" });
  useInspectorStore.setState({ tags: [pick], selection: pick, hover: pick });
  useWorkspaceStore.setState({ activeWorkspaceId: "a" });
  expect(useInspectorStore.getState().tags).toHaveLength(1);
  useWorkspaceStore.getState().setActiveWorkspaceId("b");
  const { tags, selection, hover } = useInspectorStore.getState();
  expect({ tags, selection, hover }).toMatchInlineSnapshot(`
    {
      "hover": null,
      "selection": null,
      "tags": [],
    }
  `);
});
