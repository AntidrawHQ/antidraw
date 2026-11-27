import { expect, it } from "vitest";
import { fit, type Box } from "../crop";

// The part of a capture a thumbnail shows, for a 96×60 tile (the list's).
const TILE = 96 / 60;
const shown = (frames: Box, ratio: number) => {
  const part = fit(frames, ratio, TILE);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    x: round(part.x),
    y: round(part.y),
    width: round(part.width),
    height: round(part.height),
    // The tile's shape, in the capture's own pixels.
    aspect: round((part.width * ratio) / part.height),
    // The frames' middle is the tile's.
    centred:
      round(part.x + part.width / 2) === round(frames.x + frames.width / 2) &&
      round(part.y + part.height / 2) === round(frames.y + frames.height / 2),
  };
};

it("shows the frames with a margin, in the tile's shape, about their middle", () => {
  expect({
    // Frames across the middle half of a square capture.
    "frames in the middle": shown({ x: 0.25, y: 0.3, width: 0.5, height: 0.25 }, 1),
    // Tall frames: the tile is as tall as they are, and wider than the capture.
    "taller than the tile": shown({ x: 0.4, y: 0.1, width: 0.2, height: 0.8 }, 1),
    // A capture taller than wide, as the canvas is beside the chat.
    "a tall capture": shown({ x: 0.2, y: 0.4, width: 0.6, height: 0.2 }, 640 / 854),
    // One small frame: no closer than a third of the capture's width.
    "a small frame": shown({ x: 0.48, y: 0.48, width: 0.04, height: 0.04 }, 1),
  }).toMatchInlineSnapshot(`
    {
      "a small frame": {
        "aspect": 1.6,
        "centred": true,
        "height": 0.187,
        "width": 0.3,
        "x": 0.35,
        "y": 0.406,
      },
      "a tall capture": {
        "aspect": 1.6,
        "centred": true,
        "height": 0.32,
        "width": 0.684,
        "x": 0.158,
        "y": 0.34,
      },
      "frames in the middle": {
        "aspect": 1.6,
        "centred": true,
        "height": 0.356,
        "width": 0.57,
        "x": 0.215,
        "y": 0.247,
      },
      "taller than the tile": {
        "aspect": 1.6,
        "centred": true,
        "height": 0.912,
        "width": 1.459,
        "x": -0.23,
        "y": 0.044,
      },
    }
  `);
});
