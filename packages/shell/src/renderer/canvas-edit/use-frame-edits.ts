import { useMemo } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  frameLayoutOf,
  frameNodeId,
  useCanvasControls,
  type FrameLayout,
  type FrameMove,
  type FrameNode,
} from "@/renderer/canvas/Canvas";
import {
  createComponents,
  deleteComponents,
  getComponentSource,
  type FrameLayoutData,
} from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import { track } from "@/renderer/lib/analytics";
import { centredOn, copyName, offsetBy } from "./frames";
import { UndoStack } from "./undo-stack";

// The canvas's own changes to its frames: copy, cut, paste, duplicate and
// delete, each undoable, and the selection. A frame is a file, so a paste
// writes one and a delete moves one to the trash.
//
// The canvas shows what the app knows of the files: the list of components
// and where each frame is saved to go. So a change here is told to both as
// it's made (a new frame's place first, then its file, then its name on the
// list), and the canvas draws it from there, as it does a frame the agent
// made. The watcher says the same of the files a moment later.

// A frame as copied: its source then, and where it was.
export type ClipFrame = { name: string; source: string; layout: FrameLayout };

// What the user did, to undo: what it was, not how to undo it (`apply`, of
// the canvas that's up when it's undone).
type Entry =
  | { type: "moved"; moves: FrameMove[] }
  // Frames made (a paste, a duplicate): undone, they go, unless one has
  // changed since (the agent's edit is kept); redone, they're back where
  // they were when undone.
  | { type: "created"; frames: ClipFrame[] }
  // Frames deleted: undone, they're back where they were.
  | { type: "deleted"; frames: ClipFrame[] };

// What the clipboard holds, when it's frames. The system clipboard gets its
// id (and its names, as text): a paste is of these frames only if the
// clipboard still has them, and not text copied since.
type Clip = {
  id: string;
  workspaceId: string;
  text: string;
  frames: Promise<ClipFrame[]>;
  // How many times it's been pasted beside its frames: each lands further on.
  pastes: number;
};

export const CLIP_TYPE = "application/x-antidraw-frames";

// One for the app: the clipboard outlives a switch of workspace.
let clip: Clip | null = null;

export type Via = "shortcut" | "clipboard" | "menu";

const failed = (prefix: string) => (error: unknown) => {
  throw new Error(`${prefix}${error instanceof Error ? error.message : String(error)}`);
};

const report = (error: unknown) => {
  console.error("[canvas-edit]", error);
  toast(error instanceof Error ? error.message : "Couldn't change the canvas");
};

// A workspace's undo stack, kept across switches to the others.
const stacks = new Map<string, UndoStack<Entry>>();
const undoStackFor = (workspaceId: string) => {
  let stack = stacks.get(workspaceId);
  if (!stack) {
    stack = new UndoStack<Entry>(report);
    stacks.set(workspaceId, stack);
  }
  return stack;
};

// How long a change waits for the canvas to show it before going on. It
// shows within a frame or two; a canvas that's down never does.
const SHOWN_MS = 1000;

// Its frames in reading order: rows, top to bottom, then left to right.
const ROW = 200;
const readingOrder = (a: FrameNode, b: FrameNode) =>
  Math.floor(a.position.y / ROW) - Math.floor(b.position.y / ROW) || a.position.x - b.position.x;

export const useFrameEdits = (workspaceId: string) => {
  const reactFlow = useReactFlow<FrameNode>();
  const store = useStoreApi<FrameNode>();
  const controls = useCanvasControls();
  const queryClient = useQueryClient();

  return useMemo(() => {
    const stack = undoStackFor(workspaceId);
    const nodes = () => reactFlow.getNodes();
    const selected = () => nodes().filter((n) => n.selected);

    const listKey = queryKeys.userComponents.byWorkspace(workspaceId);
    const layoutsKey = queryKeys.frameLayouts.byWorkspace(workspaceId);

    // The list of components, as the files are after a change made here. A
    // fetch of it begun before the change would bring the list back as it was.
    const setListed = async (change: (list: { name: string }[]) => { name: string }[]) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      queryClient.setQueryData<{ name: string }[]>(listKey, (list) => list && change(list));
    };
    // Where frames are saved to go, less the ones named, plus these.
    const setPlaces = (names: string[], layouts: FrameLayout[] = []) => {
      const gone = new Set(names);
      queryClient.setQueryData<FrameLayoutData[]>(layoutsKey, (saved = []) => [
        ...saved.filter((l) => !gone.has(l.componentName)),
        ...layouts.map((l) => ({ ...l, workspaceId })),
      ]);
    };

    // Once the frames are on the canvas (or off it): the next change, an
    // undo's or a second paste's, finds the canvas as this one left it.
    const shown = (names: string[], present: boolean) =>
      new Promise<void>((resolve) => {
        const ids = names.map(frameNodeId);
        const there = () => ids.every((id) => store.getState().nodeLookup.has(id) === present);
        if (there()) return resolve();
        const done = () => {
          clearTimeout(timer);
          stop();
          resolve();
        };
        const stop = store.subscribe(() => there() && done());
        const timer = setTimeout(done, SHOWN_MS);
      });

    // These frames selected, and no others. Not addSelectedNodes: with Cmd
    // still down (as it is after Cmd+D or Cmd+Z) that adds to the selection.
    const select = (names: string[]) => {
      const { nodeLookup, triggerNodeChanges } = store.getState();
      const ids = new Set(names.map(frameNodeId).filter((id) => nodeLookup.has(id)));
      if (ids.size === 0) return;
      triggerNodeChanges(
        [...nodeLookup.values()].flatMap((n) =>
          !!n.selected === ids.has(n.id) ? [] : [{ id: n.id, type: "select" as const, selected: ids.has(n.id) }],
        ),
      );
    };

    const layoutsOf = (names: string[]) => {
      const byName = new Map(nodes().map((n) => [n.data.componentName, frameLayoutOf(n)]));
      return new Map(names.flatMap((name) => (byName.has(name) ? [[name, byName.get(name)!] as const] : [])));
    };

    // Every name a new frame can't have, lower case: the canvas's, and the
    // files' (one the canvas hasn't drawn yet).
    const takenNames = () => {
      const files = queryClient.getQueryData<{ name: string }[]>(listKey) ?? [];
      return new Set([...nodes().map((n) => n.data.componentName), ...files.map((f) => f.name)].map((n) => n.toLowerCase()));
    };

    const sourcesOf = async (frames: FrameNode[]) =>
      Promise.all(
        frames.map(async (n): Promise<ClipFrame> => {
          const result = await getComponentSource(workspaceId, n.data.componentName);
          if (result.isErr()) throw new Error(`Couldn't read ${n.data.componentName}`);
          return { name: n.data.componentName, source: result.value.source, layout: frameLayoutOf(n) };
        }),
      );

    // Writes the frames' files, each with its place, and selects them once
    // they're on the canvas.
    const create = async (frames: ClipFrame[]) => {
      const names = frames.map((f) => f.name);
      setPlaces(names, frames.map((f) => ({ ...f.layout, componentName: f.name })));
      const result = await createComponents(
        workspaceId,
        frames.map(({ name, source }) => ({ name, source })),
      );
      if (result.isErr()) {
        setPlaces(names);
        throw new Error(result.error.message);
      }
      await setListed((list) => {
        const listed = new Set(list.map((c) => c.name));
        return [...list, ...names.filter((name) => !listed.has(name)).map((name) => ({ name }))];
      });
      await shown(names, true);
      select(names);
    };

    // Trashes the frames' files and gives back what they were, and where.
    // With `known` (the frames as the canvas last wrote or read them), one
    // that has changed since is refused. Throws if none went.
    const remove = async (names: string[], known?: ClipFrame[]) => {
      const layouts = layoutsOf(names);
      const was = new Map((known ?? []).map((f) => [f.name, f.layout]));
      const result = await deleteComponents(
        workspaceId,
        names,
        known?.map(({ name, source }) => ({ name, source })),
      );
      if (result.isErr()) throw new Error(result.error.message);
      const { deleted, failed: refused } = result.value;
      if (deleted.length === 0) throw new Error(`Couldn't move ${refused.join(", ")} to the trash`);
      if (refused.length > 0) toast(`Couldn't move ${refused.join(", ")} to the trash`);
      const gone = deleted.map((d) => d.name);
      setPlaces(gone);
      await setListed((list) => list.filter((c) => !gone.includes(c.name)));
      await shown(gone, false);
      return deleted.map(
        (d): ClipFrame => ({
          ...d,
          layout: layouts.get(d.name) ?? was.get(d.name) ?? { componentName: d.name, x: 0, y: 0, width: 400, height: 300 },
        }),
      );
    };

    // An entry undone or redone, on this canvas, and the entry as it is after.
    const apply = async (entry: Entry, direction: "undo" | "redo"): Promise<Entry> => {
      if (entry.type === "moved") {
        const side = direction === "undo" ? "from" : "to";
        controls.moveFrames(entry.moves.map((m) => ({ componentName: m.componentName, ...m[side] })));
        select(entry.moves.map((m) => m.componentName));
        return entry;
      }
      const prefix = direction === "undo" ? "Can't undo: " : "Can't redo: ";
      // Frames made, undone, go; frames deleted, undone, are back. Redone,
      // the other way.
      const going = (entry.type === "created") === (direction === "undo");
      if (!going) {
        await create(entry.frames).catch(failed(prefix));
        return entry;
      }
      // The ones that went, where they were as they went: one the trash
      // refused is still a file, and no longer this entry's.
      const gone = await remove(entry.frames.map((f) => f.name), entry.frames).catch(failed(prefix));
      return { ...entry, frames: gone };
    };

    const edited = (action: string, count: number, via: Via) =>
      track("canvas_frames_edited", { action, count, via });

    // The view's middle, and whether a box is in the view, on the canvas.
    const view = () => {
      const rect = store.getState().domNode?.getBoundingClientRect();
      if (!rect) return null;
      const topLeft = reactFlow.screenToFlowPosition({ x: rect.left, y: rect.top });
      const bottomRight = reactFlow.screenToFlowPosition({ x: rect.right, y: rect.bottom });
      return {
        middle: { x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 },
        shows: (l: FrameLayout) =>
          l.x < bottomRight.x && l.x + l.width > topLeft.x && l.y < bottomRight.y && l.y + l.height > topLeft.y,
      };
    };

    return {
      // The selected frames, onto the clipboard: their sources as they are
      // now. Null: none selected, so the clipboard's the page's.
      copy(via: Via) {
        const frames = selected();
        if (frames.length === 0) return null;
        const names = frames.map((n) => n.data.componentName);
        const copied = sourcesOf(frames);
        copied.catch(() => {}); // Reported if it's pasted.
        clip = { id: crypto.randomUUID(), workspaceId, text: names.join("\n"), frames: copied, pastes: 0 };
        edited("copy", frames.length, via);
        return clip;
      },

      // Copied, then deleted: undone, they're back.
      cut(via: Via) {
        const frames = selected();
        if (frames.length === 0) return null;
        controls.flushMoves();
        const names = frames.map((n) => n.data.componentName);
        let settle!: { resolve: (f: ClipFrame[]) => void; reject: (e: unknown) => void };
        const cutFrames = new Promise<ClipFrame[]>((resolve, reject) => (settle = { resolve, reject }));
        cutFrames.catch(() => {});
        const cutting: Clip = { id: crypto.randomUUID(), workspaceId, text: names.join("\n"), frames: cutFrames, pastes: 0 };
        clip = cutting;
        void stack.perform(async () => {
          try {
            const gone = await remove(names);
            settle.resolve(gone);
            return { type: "deleted", frames: gone };
          } catch (e) {
            // Nothing was cut: nothing to paste.
            settle.reject(e);
            if (clip === cutting) clip = null;
            throw e;
          }
        });
        edited("cut", frames.length, via);
        return cutting;
      },

      // Whether the system clipboard's frames are the ones copied here last.
      // Its text alone will do when that's all it kept (the menu's Copy).
      holdsClip(data: DataTransfer | null) {
        if (!clip || !data) return false;
        const id = data.getData(CLIP_TYPE);
        return id ? id === clip.id : data.getData("text/plain") === clip.text;
      },

      hasClip: () => clip !== null,

      // The clipboard's frames as new ones, under the pointer (a point on
      // screen) if it's on the canvas. Else beside the ones copied, each
      // paste further on, or, with those gone (a cut) and out of view, in
      // the middle of it. A name taken gets a copy's.
      paste(at: { x: number; y: number } | null, via: Via) {
        const pasting = clip;
        if (!pasting) return;
        if (pasting.workspaceId !== workspaceId) {
          toast("Frames paste into the workspace they were copied from");
          return;
        }
        const steps = ++pasting.pastes;
        controls.flushMoves();
        void stack.perform(async () => {
          const frames = await pasting.frames.catch(failed("Can't paste: "));
          const taken = takenNames();
          const present = frames.some((f) => taken.has(f.name.toLowerCase()));
          const names = frames.map((f) => (taken.has(f.name.toLowerCase()) ? copyName(f.name, taken) : (taken.add(f.name.toLowerCase()), f.name)));
          const was = frames.map((f) => f.layout);
          const shown = view();
          const layouts = at
            ? centredOn(was, reactFlow.screenToFlowPosition(at))
            : present
              ? offsetBy(was, steps)
              : !shown || was.some(shown.shows)
                ? was
                : centredOn(was, shown.middle);
          const made = frames.map((f, i) => ({ ...f, name: names[i]!, layout: { ...layouts[i]!, componentName: names[i]! } }));
          await create(made);
          edited("paste", made.length, via);
          return { type: "created", frames: made };
        });
      },

      // Copies of the selected frames, beside them. The clipboard is left be.
      duplicate(via: Via) {
        const frames = selected();
        if (frames.length === 0) return;
        controls.flushMoves();
        void stack.perform(async () => {
          const copies = await sourcesOf(frames);
          const taken = takenNames();
          const layouts = offsetBy(copies.map((c) => c.layout), 1);
          const made = copies.map((c, i) => {
            const name = copyName(c.name, taken);
            return { ...c, name, layout: { ...layouts[i]!, componentName: name } };
          });
          await create(made);
          edited("duplicate", made.length, via);
          return { type: "created", frames: made };
        });
      },

      deleteSelected(via: Via) {
        const names = selected().map((n) => n.data.componentName);
        if (names.length === 0) return;
        controls.flushMoves();
        void stack.perform(async () => {
          const gone = await remove(names);
          edited("delete", gone.length, via);
          return { type: "deleted", frames: gone };
        });
      },

      recordMoves: (moves: FrameMove[]) => void stack.push({ type: "moved", moves }),

      // Before each change, flushMoves: a run of arrow keys still settling is
      // a move made before it, to undo after it.
      undo(via: Via) {
        controls.flushMoves();
        void stack.undo(apply).then((did) => did && edited("undo", 1, via));
      },

      redo(via: Via) {
        controls.flushMoves();
        void stack.redo(apply).then((did) => did && edited("redo", 1, via));
      },

      selectAll: () => store.getState().addSelectedNodes(nodes().map((n) => n.id)),

      clearSelection: () => {
        if (selected().length === 0) return false;
        store.getState().unselectNodesAndEdges();
        return true;
      },

      // The next frame in reading order (or the one before), selected, and
      // brought into view if it isn't.
      step(direction: 1 | -1) {
        const ordered = [...nodes()].sort(readingOrder);
        if (ordered.length === 0) return;
        // From the last selected going on, the first going back.
        const picked = ordered.flatMap((n, i) => (n.selected ? [i] : []));
        const current = picked.length === 0 ? -1 : direction === 1 ? picked.at(-1)! : picked[0]!;
        const next = current === -1
          ? ordered[direction === 1 ? 0 : ordered.length - 1]!
          : ordered[(current + direction + ordered.length) % ordered.length]!;
        store.getState().addSelectedNodes([next.id]);
        const layout = frameLayoutOf(next);
        if (!view()?.shows(layout) || !fullyShown(layout)) {
          void reactFlow.setCenter(layout.x + layout.width / 2, layout.y + layout.height / 2, {
            zoom: reactFlow.getZoom(),
            duration: 200,
          });
        }
      },

      selectedFrames: selected,
    };

    function fullyShown(l: FrameLayout) {
      const rect = store.getState().domNode?.getBoundingClientRect();
      if (!rect) return true;
      const topLeft = reactFlow.flowToScreenPosition({ x: l.x, y: l.y });
      const bottomRight = reactFlow.flowToScreenPosition({ x: l.x + l.width, y: l.y + l.height });
      return topLeft.x >= rect.left && topLeft.y >= rect.top && bottomRight.x <= rect.right && bottomRight.y <= rect.bottom;
    }
  }, [workspaceId, reactFlow, store, controls, queryClient]);
};

export type FrameEdits = ReturnType<typeof useFrameEdits>;
