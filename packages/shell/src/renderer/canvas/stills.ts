// Stills: while the canvas pans or zooms, each frame on screen shows a
// picture of itself and its live iframe is held hidden. A hidden frame keeps
// its document, its state and its timers, but draws nothing, so the move
// costs the compositor a few images instead of every frame's own rendering.
// The frames are live again the moment the move ends.
//
// The pictures are taken ahead of the move, while the canvas is at rest: a
// capture is not instant, and one taken mid-move would be cut at the wrong
// place by however far the canvas travelled meanwhile.
//
// Nothing here knows how the pixels are taken: the host passes a CaptureArea
// (the shell asks main for the window's). Without one there are no stills,
// and every frame stays live throughout (the published viewer).

export type AreaRect = { x: number; y: number; width: number; height: number };

// The pixels of a part of the page, frames included. `rect` is in the page's
// CSS pixels. Null when they can't be taken now (something covers the canvas).
export type CaptureArea = (rect: AreaRect) => Promise<ImageBitmap | null>;

// The most still pixels kept at once, across all frames: 24M is about 96 MB.
// A still is as large as its frame was on screen, so zooming into frame after
// frame would otherwise keep a full-size picture of each.
const MAX_STILL_PIXELS = 24_000_000;

// A frame smaller than this on screen has nothing worth a picture.
const MIN_STILL_SIZE = 4;

// A still is shown only where it has at least this share of the pixels its
// frame takes on screen now. One taken with the canvas zoomed far out is a
// smudge on a frame seen close up, and the live frame is better than that.
const MIN_SHARPNESS = 0.5;

// After a move ends, the stills stay over the frames this long: a frame shown
// again takes a moment to draw, and the gap would flash its background.
const UNCOVER_MS = 120;

type Frame = {
  // The still's own element, over the iframe in the frame's wrapper.
  canvas: HTMLCanvasElement;
  iframe: HTMLIFrameElement | null;
  // The frame's layout size when its still was taken: a frame resized since
  // has a still of the wrong shape. 0 pixels: no still.
  width: number;
  height: number;
  pixels: number;
  takenAt: number;
  held: boolean;
};

const intersects = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export class FrameStills {
  private frames = new Map<string, Frame>();
  private holding = false;
  private uncover: ReturnType<typeof setTimeout> | undefined;
  // Counts captures, so one overtaken by a move or a later capture is dropped.
  private generation = 0;

  // A frame's still element, for as long as the frame is on the canvas.
  register(componentName: string, canvas: HTMLCanvasElement) {
    this.frames.set(componentName, {
      canvas,
      iframe: null,
      width: 0,
      height: 0,
      pixels: 0,
      takenAt: 0,
      held: false,
    });
    return () => {
      if (this.frames.get(componentName)?.canvas === canvas) this.frames.delete(componentName);
    };
  }

  // The frame's iframe, once there is one (and again when it's replaced).
  setIframe(componentName: string, iframe: HTMLIFrameElement | null) {
    const frame = this.frames.get(componentName);
    if (!frame) return;
    frame.iframe = iframe;
    // A new iframe starts visible; the still of the old one would cover it.
    if (!this.holding) this.show(frame);
  }

  // A move starts, with the canvas at `zoom`: every frame with a still sharp
  // enough for it shows the still, and its iframe is held.
  hold(zoom: number) {
    clearTimeout(this.uncover);
    this.uncover = undefined;
    this.holding = true;
    this.generation++;
    // Read every size before changing any style: one layout, not one a frame.
    const held: Frame[] = [];
    for (const frame of this.frames.values()) {
      const { iframe } = frame;
      if (!iframe || frame.pixels === 0) continue;
      if (iframe.offsetWidth !== frame.width || iframe.offsetHeight !== frame.height) continue;
      const onScreen = frame.width * zoom * window.devicePixelRatio;
      if (frame.canvas.width < onScreen * MIN_SHARPNESS) continue;
      // The frame being typed in keeps its focus: hiding it would blur it.
      if (document.activeElement === iframe) continue;
      held.push(frame);
    }
    for (const frame of held) {
      frame.held = true;
      frame.canvas.style.visibility = "visible";
      frame.iframe!.style.visibility = "hidden";
    }
  }

  // The move ended: the frames are live again, under their stills until
  // they've drawn.
  release() {
    if (!this.holding) return;
    this.holding = false;
    for (const frame of this.frames.values()) {
      if (frame.held && frame.iframe) frame.iframe.style.visibility = "";
    }
    clearTimeout(this.uncover);
    this.uncover = setTimeout(() => {
      this.uncover = undefined;
      for (const frame of this.frames.values()) if (frame.held) this.show(frame);
    }, UNCOVER_MS);
  }

  get moving() {
    return this.holding || this.uncover !== undefined;
  }

  // Takes a still of every frame wholly on screen in `area`, for the next
  // move. Call it while the canvas is at rest. `overlays` are what's drawn
  // over the canvas at a fixed place (its panels): a frame under one is
  // skipped, or its still would carry a piece of the panel along.
  async capture(area: HTMLElement, overlays: Element[], captureArea: CaptureArea) {
    if (this.moving) return;
    const generation = ++this.generation;
    const bounds = area.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const covered = overlays.map((el) => el.getBoundingClientRect());

    const wanted: { frame: Frame; rect: DOMRect }[] = [];
    for (const frame of this.frames.values()) {
      const { iframe } = frame;
      if (!iframe) continue;
      const rect = iframe.getBoundingClientRect();
      if (rect.width < MIN_STILL_SIZE || rect.height < MIN_STILL_SIZE) continue;
      if (
        rect.left < bounds.left ||
        rect.top < bounds.top ||
        rect.right > bounds.right ||
        rect.bottom > bounds.bottom
      ) {
        continue;
      }
      if (covered.some((c) => intersects(rect, c))) continue;
      wanted.push({ frame, rect });
    }
    if (wanted.length === 0) return;

    let bitmap: ImageBitmap | null;
    try {
      bitmap = await captureArea({
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      });
    } catch {
      return;
    }
    if (!bitmap) return;
    // A move began, or a later capture did, while this one was being taken.
    if (generation !== this.generation || this.moving) {
      bitmap.close();
      return;
    }

    const scale = bitmap.width / bounds.width;
    const now = performance.now();
    for (const { frame, rect } of wanted) {
      const { iframe } = frame;
      if (!iframe) continue;
      // Moved or resized since it was measured (a drag, a component growing).
      const current = iframe.getBoundingClientRect();
      if (
        Math.abs(current.left - rect.left) > 0.5 ||
        Math.abs(current.top - rect.top) > 0.5 ||
        Math.abs(current.width - rect.width) > 0.5 ||
        Math.abs(current.height - rect.height) > 0.5
      ) {
        continue;
      }
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      frame.canvas.width = width;
      frame.canvas.height = height;
      const context = frame.canvas.getContext("2d");
      if (!context) continue;
      context.drawImage(
        bitmap,
        (rect.left - bounds.left) * scale,
        (rect.top - bounds.top) * scale,
        rect.width * scale,
        rect.height * scale,
        0,
        0,
        width,
        height,
      );
      frame.width = iframe.offsetWidth;
      frame.height = iframe.offsetHeight;
      frame.pixels = width * height;
      frame.takenAt = now;
    }
    bitmap.close();
    this.trim();
  }

  // Drops the oldest stills until the rest fit the budget.
  private trim() {
    const stills = [...this.frames.values()].filter((f) => f.pixels > 0);
    let total = stills.reduce((sum, f) => sum + f.pixels, 0);
    if (total <= MAX_STILL_PIXELS) return;
    stills.sort((a, b) => a.takenAt - b.takenAt);
    for (const frame of stills) {
      if (total <= MAX_STILL_PIXELS) break;
      total -= frame.pixels;
      frame.pixels = 0;
      frame.canvas.width = 0;
      frame.canvas.height = 0;
    }
  }

  private show(frame: Frame) {
    frame.held = false;
    frame.canvas.style.visibility = "hidden";
    if (frame.iframe) frame.iframe.style.visibility = "";
  }
}
