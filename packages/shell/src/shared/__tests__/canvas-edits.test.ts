import { expect, test } from "vitest";
import type { ElementInfo } from "../../agent/protocol";
import type { Style } from "../design";
import { describeEdits, splitEdits } from "../utils/canvas-edits";

// Design edits as the agent reads them, and read back for the chat's bubble.

const base = { radius: 16, pt: 24, pr: 24, pb: 24, pl: 24 } as Style;
const element = { ref: { loc: "src/components/user-components/Card.tsx:3:5", index: 0, path: [0], tag: "div" } } as ElementInfo;

const message = describeEdits([
  {
    id: 4,
    componentName: "Card",
    element,
    name: "div.card",
    text: false,
    base,
    now: { ...base, radius: 24 },
    seen: null,
    block: '<element>\nelement: div.card\n  <div class="card">\n</element>',
    preview: "https://localhost:5173/preview?componentName=Card",
    frame: "400×300",
  },
]);

test("each element with what changed on it, and the CSS that previewed it", () => {
  expect(message).toBe(
    [
      "<canvas-edits>",
      '<edit id="4" component="Card" file="src/components/user-components/Card.tsx" preview="https://localhost:5173/preview?componentName=Card" frame="400×300">',
      "<element>",
      "element: div.card",
      '  <div class="card">',
      "</element>",
      "Corner radius: 16 → 24",
      "previewed as: border-radius: 24px",
      "</edit>",
      "</canvas-edits>",
    ].join("\n"),
  );
});

test("reads back into the components and their changes", () => {
  expect(splitEdits(message)).toEqual({ edits: [{ component: "Card", changes: ["Corner radius: 16 → 24"] }], text: "" });
  expect(splitEdits("Make it blue")).toBeNull();
});
