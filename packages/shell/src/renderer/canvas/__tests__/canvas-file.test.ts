import { expect, it } from "vitest";
import { canvasLayout } from "../canvas-file";

// What canvas.json keeps of each frame's saved layout (a frame_layouts row).

it("keeps a size set in the size menu and an Auto height, and only says so when they are", () => {
  const row = { workspaceId: "ws", componentName: "Card", x: 10, y: 20, width: 390, height: 844 };
  expect([
    canvasLayout({ ...row, sized: false, autoHeight: false }),
    canvasLayout({ ...row, sized: true, autoHeight: false }),
    canvasLayout({ ...row, sized: true, autoHeight: true }),
  ]).toEqual([
    { componentName: "Card", x: 10, y: 20, width: 390, height: 844 },
    { componentName: "Card", x: 10, y: 20, width: 390, height: 844, sized: true },
    { componentName: "Card", x: 10, y: 20, width: 390, height: 844, sized: true, autoHeight: true },
  ]);
});
