import { expect, it, vi } from "vitest";
import type { ElementContext, ElementInfo } from "@/agent/protocol";
import type { Comment } from "@/main/api";

// What a send tells Claude about each draft's element: what its frame said
// about it when the comment was left, wherever it was left.

// The frame of Card.
vi.mock("@/renderer/inspector/bridge", () => ({
  frameUrl: (frame: string) => `https://frame.test/preview?componentName=${frame}`,
  getElementContext: vi.fn(async (picks: unknown[]) => picks.map(() => context({ html: `<li class="item">Walk dog</li>` }))),
}));

const { getElementContext } = await import("@/renderer/inspector/bridge");
const { describeElements, withSeen } = await import("../comment-ops");

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

it("keeps with a comment's element what its frame says about it when the comment is left", async () => {
  expect(await withSeen("Card", info())).toEqual({ ...info(), seen: context({ html: `<li class="item">Walk dog</li>` }) });
  expect(vi.mocked(getElementContext)).toHaveBeenCalledExactlyOnceWith([{ frame: "Card", info: info() }]);
  expect(await withSeen("Card", null)).toBeNull();
});

it("describes each draft's element as its frame saw it then, without asking it again, or as last seen", () => {
  vi.mocked(getElementContext).mockClear();
  const seen = context({ viewport: [1440, 900], html: `<li class="item">Banana</li>`, size: [400, 32] });
  const described = describeElements([
    draft(1, { ...info(), seen }),
    // Its frame couldn't say; and one from before comments kept what it saw.
    draft(2, { ...info(), seen: null }),
    draft(3, { ...info() }),
    draft(4, null),
  ]);
  expect(vi.mocked(getElementContext)).not.toHaveBeenCalled();
  expect(described.map((d) => [d.id, d.frame, /Banana/.exec(d.element ?? "")?.[0], /as last seen/.test(d.element ?? "")])).toEqual([
    [1, "1440×900", "Banana", false],
    [2, null, "Banana", true],
    [3, null, "Banana", true],
    [4, null, undefined, false],
  ]);
});

it("describes a comment saved by an earlier version, whose window saw it in another shape, as last seen", () => {
  // Before the element's markup: what React's internals said.
  const old = { viewport: [1440, 900], element: "li.item", text: "Banana", loc: `${OWN}:7:9`, components: [], attributes: {} };
  const [described] = describeElements([draft(5, { ...info(), seen: old })]);
  expect(described!.element).toContain("as last seen");
  expect(described!.frame).toBeNull();
});
