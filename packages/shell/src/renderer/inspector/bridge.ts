import {
  INSPECTOR_NS,
  INSPECTOR_PROTOCOL,
  type ElementContext,
  type ElementRef,
  type Envelope,
  type FromFrame,
  type ToFrame,
  type WalkDirection,
} from "@antidrawapp/runtime/inspector";
import { useInspectorStore, type Picked } from "./store";

// The canvas side of the inspector protocol (@antidrawapp/runtime/inspector):
// which iframe is which frame, requests and their answers, and the frames'
// own news (ready, selection moved or gone) written into the store.

type Request = ToFrame extends infer T ? (T extends ToFrame ? Omit<T, "id"> : never) : never;
type Reply = Extract<FromFrame, { id?: number }>;

const store = useInspectorStore;
const iframes = new Map<string, HTMLIFrameElement>();
const pending = new Map<number, { frame: string; resolve: (msg: Reply | null) => void }>();
const latestHit = new Map<string, number>();
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
  target.postMessage({ ns: INSPECTOR_NS, ...msg } satisfies Envelope<ToFrame>, origin);
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
  if (data?.ns !== INSPECTOR_NS) return;
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
      if (data.protocol !== INSPECTOR_PROTOCOL) return;
      s.setFrame(frame, { ready: true, tagged: data.tagged });
      // A reload lost the frame's selection; give it back.
      if (s.selection?.frame === frame) void select(frame, s.selection.info.ref);
      return;
    }
    case "selection-changed":
      if (s.selection?.frame === frame) s.setSelection({ frame, info: data.info });
      return;
    case "selection-lost":
      if (s.selection?.frame === frame) s.setSelection(null);
      return;
  }
}

let listening = false;

// The canvas calls this for each frame's iframe. Returns the unregister.
export function registerFrame(frame: string, iframe: HTMLIFrameElement) {
  if (!listening) {
    window.addEventListener("message", onMessage);
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
    const s = store.getState();
    s.setFrame(frame, null);
    if (s.hover?.frame === frame) s.setHover(null);
  };
}

// The URL a frame previews its component at.
export const frameUrl = (frame: string) => iframes.get(frame)?.src ?? null;

// An element tagged in a frame's own window (PreviewWindow), which shows the
// same component from the same dev server. Taken only while this canvas has
// that frame from that server: a window left open on another workspace's
// component would name a file this one doesn't have.
export function tagFromPreview(pick: Picked, url: string) {
  const src = frameUrl(pick?.frame);
  if (!src || !pick.info?.ref) return;
  try {
    if (new URL(src).origin !== new URL(url).origin) return;
  } catch {
    return;
  }
  store.getState().addTag(pick);
}

// ── What the canvas asks ─────────────────────────────────────────────────

// Hover at a point in the frame's CSS pixels. Answers that arrive after a
// later hover are dropped.
export async function hoverAt(frame: string, x: number, y: number) {
  // The id request() is about to use.
  const id = nextId;
  latestHit.set(frame, id);
  const reply = await request(frame, { type: "hit", x, y });
  if (reply?.type !== "hover" || latestHit.get(frame) !== id) return;
  if (!store.getState().active) return;
  store.getState().setHover(reply.info && { frame, info: reply.info });
}

// The element at a point in the frame's CSS pixels, without hovering or
// selecting it (a comment's pin). Null where there's none, or no answer.
export async function elementAt(frame: string, x: number, y: number) {
  const reply = await request(frame, { type: "hit", x, y });
  return reply?.type === "hover" ? reply.info : null;
}

export const clearHover = (frame: string) => {
  latestHit.set(frame, nextId++);
  if (store.getState().hover?.frame === frame) store.getState().setHover(null);
};

// Asks a frame to select, and takes its answer unless a later selection or
// a clear came first. A frame the selection leaves stops following it.
async function selecting(frame: string, msg: Request) {
  // The id request() is about to use.
  const id = nextId;
  latestSelect = id;
  const reply = await request(frame, msg);
  if (reply?.type !== "selected" || latestSelect !== id) return;
  const previous = store.getState().selection;
  if (previous && previous.frame !== frame) post(previous.frame, { type: "select", id: nextId++, ref: null });
  store.getState().setSelection(reply.info && { frame, info: reply.info });
}

export const selectAt = (frame: string, x: number, y: number) => selecting(frame, { type: "select-at", x, y });

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
// or doesn't answer. Only a frame that speaks this protocol is asked: one on
// an older runtime would answer in another shape.
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

export async function getSelectedElementContext() {
  const selection = store.getState().selection;
  return selection ? (await getElementContext([selection]))[0]! : null;
}
