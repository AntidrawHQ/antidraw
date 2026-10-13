import {
  AGENT_NS,
  type ElementContext,
  type ElementInfo,
  type ElementRef,
  type Envelope,
  type FromFrame,
  type PreviewItem,
  type Rect,
  type ToFrame,
  type Tool,
  type WalkDirection,
  type WheelMode,
} from "@/agent/protocol";
import { useInspectorStore, type Picked } from "./store";

// The shell's side of its agent in each preview frame (@/agent/protocol):
// which iframe is which frame, requests and their answers, and the frames'
// own news (ready, a pick, selection moved or gone) written into the store
// or handed to whoever listens for it.

type Request = ToFrame extends infer T ? (T extends ToFrame ? Omit<T, "id"> : never) : never;
type Reply = Extract<FromFrame, { id?: number }>;

const store = useInspectorStore;
const iframes = new Map<string, HTMLIFrameElement>();
const pending = new Map<number, { frame: string; resolve: (msg: Reply | null) => void }>();
// The elements followed in each frame (trackElements), and who gets their boxes.
const trackers = new Map<string, { refs: ElementRef[]; on: (rects: (Rect | null)[]) => void }>();
// The tool each frame has on (setFrameTool), and the element its comment
// box is on (markElement): a reload forgets them, so they're given back.
const tools = new Map<string, Extract<Request, { type: "tool" }>>();
const marks = new Map<string, ElementRef>();
// The design edits each frame previews (previewStyles), given back the same way.
const previews = new Map<string, PreviewItem[]>();
// Who hears of each frame's comment clicks and wheel.
type WheelMsg = Extract<FromFrame, { type: "wheel" }>;
const commentClicks = new Map<string, (at: { x: number; y: number }, info: ElementInfo | null) => void>();
const wheels = new Map<string, (wheel: WheelMsg) => void>();
// The selection request whose answer counts: a later one, or a clear, makes
// an earlier one's answer stale.
let latestSelect = 0;
let nextId = 1;

const originOf = (iframe: HTMLIFrameElement) => {
  try {
    return new URL(iframe.src).origin;
  } catch {
    return null;
  }
};

function post(frame: string, msg: ToFrame) {
  const iframe = iframes.get(frame);
  const target = iframe?.contentWindow;
  const origin = iframe && originOf(iframe);
  if (!target || !origin) return false;
  target.postMessage({ ns: AGENT_NS, ...msg } satisfies Envelope<ToFrame>, origin);
  return true;
}

// Asks a frame and waits for its answer, or null if it doesn't come.
function request(frame: string, msg: Request, timeout = 1000): Promise<Reply | null> {
  const id = nextId++;
  return new Promise((resolve) => {
    if (!post(frame, { ...msg, id } as ToFrame)) return resolve(null);
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeout);
    pending.set(id, {
      frame,
      resolve: (reply) => {
        clearTimeout(timer);
        resolve(reply);
      },
    });
  });
}

function onMessage(event: MessageEvent) {
  const data = event.data as Envelope<FromFrame> | undefined;
  if (data?.ns !== AGENT_NS) return;
  // Only a registered frame, from its own origin.
  let frame: string | undefined;
  for (const [name, iframe] of iframes)
    if (iframe.contentWindow === event.source && originOf(iframe) === event.origin) frame = name;
  if (!frame) return;

  if ("id" in data && data.id !== undefined) {
    const waiting = pending.get(data.id);
    if (waiting?.frame === frame) {
      pending.delete(data.id);
      waiting.resolve(data);
    }
  }

  const s = store.getState();
  switch (data.type) {
    case "ready": {
      s.setFrame(frame, { ready: true, tagged: data.tagged, ...(data.provisional && { provisional: true }) });
      // A reload lost its tool, and what it followed.
      const tool = tools.get(frame);
      if (tool) post(frame, { ...tool, id: nextId++ });
      const mark = marks.get(frame);
      if (mark) post(frame, { type: "mark", id: nextId++, ref: mark });
      const shown = previews.get(frame);
      if (shown?.length) post(frame, { type: "preview", id: nextId++, items: shown });
      askTrack(frame);
      // A reload lost the frame's selection; give it back. On the page's root
      // standing in, before the component's element is there, not finding
      // it doesn't drop it: the next ready asks again.
      if (s.selection?.frame === frame)
        void selecting(frame, { type: "select", ref: s.selection.info.ref }, !!data.provisional);
      return;
    }
    case "selection-changed":
      if (s.selection?.frame === frame) s.setSelection({ frame, info: data.info });
      return;
    case "selection-lost":
      if (s.selection?.frame === frame) s.setSelection(null);
      return;
    case "previewed":
      if (previews.has(frame)) s.setMissing(frame, data.missing);
      return;
    case "tracked": {
      const t = trackers.get(frame);
      if (t && data.rects.length === t.refs.length) t.on(data.rects);
      return;
    }
    // A click with Inspect.
    case "selected":
      if (data.id !== undefined || !s.active) return;
      latestSelect = nextId++;
      leaveTyping();
      takeSelection(frame, data.info);
      return;
    case "comment-at":
      if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
      leaveTyping();
      commentClicks.get(frame)?.({ x: data.x, y: data.y }, data.info);
      return;
    case "hovering":
      if (hovering !== frame) leave();
      hovering = frame;
      return;
    case "gone":
      s.setFrame(frame, { ready: false, tagged: s.frames[frame]?.tagged ?? false });
      return;
    case "wheel":
      if (tools.get(frame)?.tool) wheels.get(frame)?.(data);
      return;
    // A key pressed or let go in the frame, as if on the canvas around it:
    // the tools' keys (InspectorControls, CommentControls) take it from
    // there. Not on the frame itself, whose canvas node would take arrows,
    // Enter and Esc as its own (moving it, selecting it). One let go always
    // counts: whatever has it as held must hear of it. Never with Cmd, Ctrl
    // or Alt: the agent sends none, and the page, which can post as it,
    // mustn't reach the shell's shortcuts.
    case "key": {
      const iframe = iframes.get(frame);
      if (!iframe || typeof data.key !== "string" || typeof data.code !== "string") return;
      if (data.kind !== "up" && (!tools.get(frame)?.tool || data.ctrlKey || data.metaKey || data.altKey)) return;
      (iframe.closest(".react-flow, [data-inspector-keys]") ?? document.body).dispatchEvent(
        new KeyboardEvent(data.kind === "up" ? "keyup" : "keydown", {
          key: data.key,
          code: data.code,
          shiftKey: !!data.shiftKey,
          repeat: !!data.repeat,
          bubbles: true,
          cancelable: true,
        }),
      );
      return;
    }
  }
}

// A pick in a frame leaves the keys to the tools (InspectorControls): a
// text field the shell had focused would keep them, and Enter there would
// send the chat's draft instead of tagging the pick.
function leaveTyping() {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable))
    el.blur();
}

// The frame the pointer is in, with a tool on. A frame isn't always told when
// the pointer leaves it (fast, or straight into the next frame), so the
// shell tells it: when another frame has the pointer, or the shell does,
// anywhere but on that frame.
let hovering: string | null = null;
const leave = () => {
  if (hovering) post(hovering, { type: "leave", id: nextId++ });
  hovering = null;
};
const onShellPointer = (e: PointerEvent) => {
  if (hovering && e.target !== iframes.get(hovering)) leave();
};

let listening = false;

// The canvas calls this for each frame's iframe. Returns the unregister.
export function registerFrame(frame: string, iframe: HTMLIFrameElement) {
  if (!listening) {
    window.addEventListener("message", onMessage);
    window.addEventListener("pointermove", onShellPointer, true);
    listening = true;
  }
  iframes.set(frame, iframe);
  // A frame that started before we listened says so in answer.
  const hello = () => void request(frame, { type: "hello" });
  hello();
  iframe.addEventListener("load", hello);
  return () => {
    iframe.removeEventListener("load", hello);
    if (iframes.get(frame) !== iframe) return;
    iframes.delete(frame);
    if (hovering === frame) hovering = null;
    tools.delete(frame);
    marks.delete(frame);
    previews.delete(frame);
    store.getState().setFrame(frame, null);
    store.getState().setMissing(frame, null);
  };
}

// The tool a frame has on, or none: with one, the frame has the pointer and
// picks (Inspect's click selects, Comment's goes to onCommentClick). Its
// wheel goes to onFrameWheel ("pass") or scrolls it ("scroll").
export function setFrameTool(frame: string, tool: Tool | null, wheel: WheelMode, zoom: number) {
  const msg = { type: "tool", tool, wheel, zoom } as const;
  tools.set(frame, msg);
  post(frame, { ...msg, id: nextId++ });
}

// The element a frame's comment box is on, outlined there, or none.
export function markElement(frame: string, ref: ElementRef | null) {
  if (ref) marks.set(frame, ref);
  else marks.delete(frame);
  post(frame, { type: "mark", id: nextId++, ref });
}

// The design edits a frame shows over its page, replacing the last; none
// ends them. Said only when they change: a frame that reloads is given them
// again when it's back. What it can't find goes in the store's `missing`.
export function previewStyles(frame: string, items: PreviewItem[]) {
  const was = previews.get(frame) ?? [];
  if (JSON.stringify(was) === JSON.stringify(items)) return;
  if (items.length) previews.set(frame, items);
  else previews.delete(frame);
  if (!items.length) store.getState().setMissing(frame, null);
  post(frame, { type: "preview", id: nextId++, items });
}

// Each listens to one frame, the last to ask; each returns its stop.
const listen = <T>(map: Map<string, T>, frame: string, on: T) => {
  map.set(frame, on);
  return () => {
    if (map.get(frame) === on) map.delete(frame);
  };
};
// A click in a frame with the Comment tool: where, in its CSS pixels, and on what.
export const onCommentClick = (frame: string, on: (at: { x: number; y: number }, info: ElementInfo | null) => void) =>
  listen(commentClicks, frame, on);
// The wheel over a frame with a tool on and "pass".
export const onFrameWheel = (frame: string, on: (wheel: WheelMsg) => void) => listen(wheels, frame, on);

// The URL a frame previews its component at.
export const frameUrl = (frame: string) => iframes.get(frame)?.src ?? null;

// Where elements in a frame are, now and as they move: `on` gets their boxes
// in the frame's CSS pixels, in `refs`' order, null for one it can't find,
// whenever one moves (a scroll, a resize, an edit). One set per frame: a
// later call replaces it. A frame whose runtime can't (before "track") never
// answers. Returns the stop.
export function trackElements(frame: string, refs: ElementRef[], on: (rects: (Rect | null)[]) => void) {
  const t = { refs, on };
  trackers.set(frame, t);
  askTrack(frame);
  return () => {
    if (trackers.get(frame) !== t) return;
    trackers.delete(frame);
    post(frame, { type: "track", id: nextId++, refs: [] });
  };
}

function askTrack(frame: string) {
  const t = trackers.get(frame);
  if (t) post(frame, { type: "track", id: nextId++, refs: t.refs });
}

// ── What the canvas asks ─────────────────────────────────────────────────

// A frame's selection, taken. A frame the selection leaves stops following
// (and outlining) it.
function takeSelection(frame: string, info: ElementInfo | null) {
  const previous = store.getState().selection;
  if (previous && previous.frame !== frame) post(previous.frame, { type: "select", id: nextId++, ref: null });
  store.getState().setSelection(info && { frame, info });
}

// Asks a frame to select, and takes its answer unless a later selection or
// a clear came first (or, `keep`, it found nothing).
async function selecting(frame: string, msg: Request, keep = false) {
  // The id request() is about to use.
  const id = nextId;
  latestSelect = id;
  const reply = await request(frame, msg);
  if (reply?.type !== "selected" || latestSelect !== id || (keep && !reply.info)) return;
  takeSelection(frame, reply.info);
}

export const select = (frame: string, ref: ElementRef | null) => selecting(frame, { type: "select", ref });

export async function walk(dir: WalkDirection) {
  const selection = store.getState().selection;
  if (selection) await selecting(selection.frame, { type: "walk", dir });
}

export function clearSelection() {
  latestSelect = nextId++;
  const selection = store.getState().selection;
  if (selection) post(selection.frame, { type: "select", id: nextId++, ref: null });
  store.getState().setSelection(null);
}

// What an agent is told about each pick (see ElementContext), as its frame
// sees it now: an edit may have moved it. Null where the frame can't find it
// or doesn't answer. Only a frame whose agent said it's there is asked: the
// rest would only time out.
export async function getElementContext(picks: Picked[]): Promise<(ElementContext | null)[]> {
  const byFrame = new Map<string, Picked[]>();
  const { frames } = store.getState();
  for (const p of picks) if (frames[p.frame]?.ready) byFrame.set(p.frame, [...(byFrame.get(p.frame) ?? []), p]);
  const contexts = new Map<Picked, ElementContext>();
  await Promise.all(
    [...byFrame].map(async ([frame, group]) => {
      const reply = await request(frame, { type: "context", refs: group.map((p) => p.info.ref) }, 500);
      if (reply?.type !== "context") return;
      group.forEach((p, i) => {
        const context = reply.contexts[i];
        if (context) contexts.set(p, context);
      });
    }),
  );
  return picks.map((p) => contexts.get(p) ?? null);
}

// Tags the selection with what its frame says about it now (see Picked's
// `seen`).
export async function tagSelection() {
  const selection = store.getState().selection;
  if (!selection) return;
  const [seen] = await getElementContext([selection]);
  store.getState().addTag({ ...selection, seen: seen ?? null });
}

// An element's styles as the Design panel edits them, as its frame shows it
// now (previews and all). Null where the frame can't find it or doesn't answer.
export async function getStyle(frame: string, ref: ElementRef) {
  if (!store.getState().frames[frame]?.ready) return null;
  const reply = await request(frame, { type: "style", ref }, 500);
  return reply?.type === "style" && reply.style ? { style: reply.style, text: reply.text } : null;
}

export async function getSelectedElementContext() {
  const selection = store.getState().selection;
  return selection ? (await getElementContext([selection]))[0]! : null;
}
