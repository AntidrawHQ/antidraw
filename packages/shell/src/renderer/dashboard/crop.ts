// Where the frames are in a canvas capture, so a thumbnail can show them at a
// size that reads instead of the whole canvas with the frames small in the
// middle of it.
//
// A capture is the canvas as the window had it: canvas grey, the frames, and
// the canvas's own controls in three of its corners (the tools top left, the
// panel toggle top right, the minimap bottom right). The frames are found by
// what isn't the grey, outside those corners.
//
// It reads the JPEG's pixels, so it needs nothing saved with the capture.

/** A rectangle in the capture, in fractions of its width and height. It can run past the capture's edges. */
export type Box = { x: number; y: number; width: number; height: number };

// The capture is read at this width: enough to find the frames, and it averages the JPEG's noise away.
const READ_WIDTH = 160;
// How far from the canvas's grey, per channel, counts as something on it.
const THRESHOLD = 7;
// Room left around the frames, as a share of their larger side.
const MARGIN = 0.07;
// The most it zooms in, for the list's 96px tile: a third of the capture's width is one capture pixel to one of the
// tile's on a 2x screen. A wider tile is given more of the capture (leastWidth below), to stay as sharp.
const LEAST_WIDTH = 0.3;
// A capture's width, as main saves it.
const CAPTURE_WIDTH = 640;

/** The least of a capture's width a tile `tileWidth` CSS pixels wide shows, so it isn't drawn larger than it is. */
export const leastWidth = (tileWidth: number) => Math.min(1, Math.max(LEAST_WIDTH, (tileWidth * 2) / CAPTURE_WIDTH));

/** A capture as read: its width over its height, and its frames' bounds (null: nothing on its canvas). */
export type Capture = { ratio: number; frames: Box | null };

const captures = new Map<string, Promise<Capture>>();

/**
 * Reads a capture, once: `key` names it (a workspace and its capture's version), whichever of its copies it's read
 * from. From the JPEG itself where there is one, not from a URL made for it: that one goes when its tile does.
 */
export const readCapture = (source: Blob | string, key: string): Promise<Capture> => {
  let capture = captures.get(key);
  if (!capture) {
    capture = read(source);
    captures.set(key, capture);
    // One that couldn't be read is tried again the next time it's shown.
    capture.catch(() => captures.delete(key));
  }
  return capture;
};

const picture = async (source: Blob | string) => {
  if (typeof source !== "string") return createImageBitmap(source);
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
};

const read = async (source: Blob | string): Promise<Capture> => {
  const image = await picture(source);
  const [width, height] = "naturalWidth" in image ? [image.naturalWidth, image.naturalHeight] : [image.width, image.height];
  const ratio = width / height;
  const w = READ_WIDTH;
  const h = Math.max(1, Math.round(w / ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { ratio, frames: null };
  context.drawImage(image, 0, 0, w, h);
  if ("close" in image) image.close();
  const { data } = context.getImageData(0, 0, w, h);

  // The canvas's grey: the colour there's most of.
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i]! >> 2) << 12) | ((data[i + 1]! >> 2) << 6) | (data[i + 2]! >> 2);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let grey = 0;
  let most = 0;
  for (const [key, n] of counts) if (n > most) [grey, most] = [key, n];
  const [r, g, b] = [((grey >> 12) & 63) << 2, ((grey >> 6) & 63) << 2, (grey & 63) << 2];

  // The canvas's controls, which scale with the capture's width whatever its height.
  const control = (x: number, y: number) =>
    (x < 0.09 * w && y < 0.2 * w) || (x > 0.92 * w && y < 0.07 * w) || (x > 0.7 * w && y > h - 0.21 * w);

  let [left, top, right, bottom] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // +2: the grey's bucket is four wide.
      if (Math.max(Math.abs(data[i]! - r - 2), Math.abs(data[i + 1]! - g - 2), Math.abs(data[i + 2]! - b - 2)) <= THRESHOLD) continue;
      if (control(x, y)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) return { ratio, frames: null };
  return { ratio, frames: { x: left / w, y: top / h, width: (right - left + 1) / w, height: (bottom - top + 1) / h } };
};

/**
 * The part of the capture a tile of `aspect` (its width over its height) shows: the frames with a margin, grown to
 * the tile's shape about their centre. `ratio` is the capture's own width over height.
 */
export const fit = (frames: Box, ratio: number, aspect: number, least = LEAST_WIDTH): Box => {
  // In units of the capture's width, so a square is a square.
  const fw = frames.width;
  const fh = frames.height / ratio;
  const margin = Math.max(fw, fh) * MARGIN;
  let width = Math.max(fw + 2 * margin, (fh + 2 * margin) * aspect, least);
  let height = width / aspect;
  const cx = frames.x + frames.width / 2;
  const cy = (frames.y + frames.height / 2) / ratio;
  // Back to fractions of each side.
  [width, height] = [width, height * ratio];
  return { x: cx - width / 2, y: cy * ratio - height / 2, width, height };
};
