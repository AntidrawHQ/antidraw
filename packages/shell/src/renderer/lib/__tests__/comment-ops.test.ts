import { expect, it, vi } from "vitest";
import type { ElementContext, ElementInfo } from "@/agent/protocol";
import type { Comment } from "@/main/api";

// What a send tells Claude about each draft's element: the canvas's frame
// is asked about those pinned there, and one left in a frame's own window is
// as that window saw it.

// The canvas's frame of Card, which finds a different <li> at the same ref.
vi.mock("@/renderer/inspector/bridge", () => ({
  frameUrl: (frame: string) => `https://frame.test/preview?componentName=${frame}`,
  getElementContext: vi.fn(async (picks: unknown[]) => picks.map(() => context({ html: `<li class="item">Walk dog</li>` }))),
}));

const { getElementContext } = await import("@/renderer/inspector/bridge");
const { describeElements } = await import("../comment-ops");

const OWN = "src/components/user-components/Card.tsx";

const info = (): ElementInfo => ({
  ref: { loc: `${OWN}:7:9`, index: 2, path: [0, 2], tag: "li" },
  callsite: null,
  tag: "li",
  id: "",
  classes: ["item"],
  text: "Banana",
  rect: { x: 0, y: 0, width: 400, height: 32 },
  margin: [0, 0, 0, 0],
  border: [0, 0, 0, 0],
  padding: [0, 0, 0, 0],
});

function context(over: Partial<ElementContext> = {}): ElementContext {
  return {
    viewport: [1280, 800],
    element: "li.item",
    html: `<li class="item" data-ad-loc="${OWN}:7:9"></li>`,
    text: "",
    within: null,
    path: [],
    repeat: [],
    sibling: null,
    size: [300, 32],
    margin: [0, 0, 0, 0],
    border: [0, 0, 0, 0],
    padding: [0, 0, 0, 0],
    ...over,
  };
}

const draft = (id: number, element: Record<string, unknown> | null) =>
  ({ id, componentName: "Card", x: 10, y: 20, text: "Make it bold", state: "draft", element }) as unknown as Comment;

it("asks the canvas's frame only about elements pinned there, and takes a frame window's as it saw them", async () => {
  const seen = context({ viewport: [1440, 900], html: `<li class="item">Banana</li>`, size: [400, 32] });
  const described = await describeElements([
    draft(1, { ...info() }),
    draft(2, { ...info(), seen }),
    draft(3, { ...info(), seen: null }),
    draft(4, null),
  ]);
  expect(vi.mocked(getElementContext)).toHaveBeenCalledExactlyOnceWith([{ frame: "Card", info: info() }]);
  expect(described.map((d) => [d.id, d.frame, /Walk dog|Banana/.exec(d.element ?? "")?.[0], /as last seen/.test(d.element ?? "")])).toEqual([
    [1, "1280×800", "Walk dog", false],
    [2, "1440×900", "Banana", false],
    [3, null, "Banana", true],
    [4, null, undefined, false],
  ]);
});

it("describes a comment saved by an earlier version, whose window saw it in another shape, as last seen", async () => {
  // Before the element's markup: what React's internals said.
  const old = { viewport: [1440, 900], element: "li.item", text: "Banana", loc: `${OWN}:7:9`, components: [], attributes: {} };
  const [described] = await describeElements([draft(5, { ...info(), seen: old })]);
  expect(described!.element).toContain("as last seen");
  expect(described!.frame).toBeNull();
});
