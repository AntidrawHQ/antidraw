// The share page as its preview image is taken of it (?shot): the canvas
// alone, every frame in view, and a mark on the page once the frames have
// rendered. @antidraw/server takes the picture when a publish goes live and
// waits for that mark (its services/preview.service.ts).

/** /s/<slug>?shot: the page is being photographed, not visited. */
export const isShot = (search: string) => new URLSearchParams(search).has("shot");

/** On <html> once the picture can be taken: [data-frames-ready]. */
export const READY_ATTRIBUTE = "data-frames-ready";

// After the last frame says it rendered: its images and fonts arrive after
// its component does, and the canvas lines the frames up again as each grows.
export const SETTLE_MS = 1000;
// With frames still to hear from, this long without a word from any: longer
// than the canvas keeps a silent frame's place in its loading queue (4 s)
// plus a page's load, so the next ones in the queue have had their turn.
export const QUIET_MS = 7000;
// However it's going: the picture is taken of what there is by then.
export const CAP_MS = 20_000;

/**
 * How long from now until the picture can be taken, given what the frames
 * have said so far. `sinceStart` and `sinceLast` are the ms since the canvas
 * mounted and since a frame last rendered or failed (since the mount, when
 * none has).
 */
export const readyIn = ({
  total,
  rendered,
  sinceStart,
  sinceLast,
}: {
  total: number;
  rendered: number;
  sinceStart: number;
  sinceLast: number;
}) => {
  const wait = rendered >= total ? SETTLE_MS : QUIET_MS;
  return Math.max(0, Math.min(wait - sinceLast, CAP_MS - sinceStart));
};

/* ── What the picture shows ───────────────────────────────────────────── */

export type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };

// Around the frames when all of them are shown, as a share of their extent.
const PADDING = 0.06;
// All of the canvas, when its frames fill at least this much of the picture.
const WHOLE_IS_ENOUGH = 0.15;
// Otherwise the busiest part of it, as far in as it takes for frames to fill
// this much of the picture…
const BUSY_ENOUGH = 0.3;
// …and no further in than this many typical frames across, or life size.
const FEWEST_ACROSS = 2.5;
// Each step in is this much closer.
const STEP = 1.2;
// The most frames the busiest part is looked for from.
const MAX_STARTS = 400;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// How much of `view` the frames cover (frames over one another count twice).
const covered = (frames: Rect[], view: Rect) => {
  let area = 0;
  for (const frame of frames) {
    area +=
      overlap(frame.x, frame.x + frame.width, view.x, view.x + view.width) *
      overlap(frame.y, frame.y + frame.height, view.y, view.y + view.height);
  }
  return area / (view.width * view.height);
};

// Evenly picked when there are too many to try them all.
const some = <T,>(values: T[]) =>
  values.length <= MAX_STARTS
    ? values
    : Array.from({ length: MAX_STARTS }, (_, i) => values[Math.round((i * (values.length - 1)) / (MAX_STARTS - 1))]!);

/**
 * The part of the canvas a picture of `picture`'s shape shows. All of the
 * frames when together they fill enough of it. A canvas too spread out for
 * that (many frames, or one much taller than the rest) would be a picture of
 * specks, so it shows the busiest part instead, starting at a frame's top
 * left corner: as far in as it takes for frames to fill a fair share of the
 * picture, and never so far that fewer than a few fit across. Null with no
 * frames.
 */
export const pictureOf = (frames: Rect[], picture: Size): Rect | null => {
  const sized = frames.filter((frame) => frame.width > 0 && frame.height > 0);
  if (sized.length === 0 || !(picture.width > 0) || !(picture.height > 0)) return null;

  const left = Math.min(...sized.map((f) => f.x));
  const top = Math.min(...sized.map((f) => f.y));
  const right = Math.max(...sized.map((f) => f.x + f.width));
  const bottom = Math.max(...sized.map((f) => f.y + f.height));
  const margin = Math.max(right - left, bottom - top) * PADDING;

  // A view of the picture's shape at `zoom`, placed with (x, y) at its top
  // left: centred instead along an axis it has room to spare on.
  const viewAt = (zoom: number, x: number, y: number): Rect => {
    const width = picture.width / zoom;
    const height = picture.height / zoom;
    return {
      x: width >= right - left + 2 * margin ? (left + right - width) / 2 : x,
      y: height >= bottom - top + 2 * margin ? (top + bottom - height) / 2 : y,
      width,
      height,
    };
  };

  const wholeZoom = Math.min(
    picture.width / (right - left + 2 * margin),
    picture.height / (bottom - top + 2 * margin),
  );
  const whole = viewAt(wholeZoom, left - margin, top - margin);
  if (covered(sized, whole) >= WHOLE_IS_ENOUGH) return whole;

  const closest = Math.max(wholeZoom, Math.min(1, picture.width / (FEWEST_ACROSS * median(sized.map((f) => f.width)))));
  // From the top, then the left: of two parts as busy, the earlier wins.
  const starts = some([...sized].sort((a, b) => a.y - b.y || a.x - b.x));
  let best = whole;
  for (let zoom = wholeZoom * STEP; ; zoom *= STEP) {
    const at = Math.min(zoom, closest);
    // A little of the canvas shows before the frame the view starts at.
    const inset = (picture.width / at) * (PADDING / 2);
    let most = -1;
    for (const start of starts) {
      const view = viewAt(at, start.x - inset, start.y - inset);
      const share = covered(sized, view);
      if (share > most + 1e-9) {
        most = share;
        best = view;
      }
    }
    if (most >= BUSY_ENOUGH || at >= closest) return best;
  }
};
