import { expect, it } from "vitest";
import type { ElementInfo } from "@/agent/protocol";
import { pinIn } from "../anchors";
import type { Cmt } from "../model";

// A pin keeps its spot in its element, wherever the element is now.

const element = (rect: ElementInfo["rect"]) => ({ rect }) as ElementInfo;
const cmt = (pos: Cmt["pos"], el: ElementInfo | null): Cmt => ({ id: 1, text: "", state: "draft", pos, frame: "Card", element: el, at: 0, note: null, doneAt: null });

it("puts the pin at the same spot in its element, at the element's size now", () => {
  // Dropped 3/4 across and halfway down a 400×40 button at (100, 200)...
  const c = cmt({ x: 400, y: 220 }, element({ x: 100, y: 200, width: 400, height: 40 }));
  // ...which a wider window shows 800 wide, scrolled 150 up.
  expect(pinIn(c, { x: 50, y: 50, width: 800, height: 40 })).toEqual({ x: 650, y: 70 });
});

it("leaves the pin where it was dropped where the frame can't say where its element is", () => {
  const c = cmt({ x: 400, y: 220 }, element({ x: 100, y: 200, width: 400, height: 40 }));
  expect([pinIn(c, null), pinIn(c, undefined), pinIn(cmt({ x: 5, y: 6 }, null), { x: 0, y: 0, width: 10, height: 10 })]).toEqual([
    { x: 400, y: 220 },
    { x: 400, y: 220 },
    { x: 5, y: 6 },
  ]);
});
