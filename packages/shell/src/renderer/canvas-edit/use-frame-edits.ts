import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { createComponents, deleteComponents, getComponentSource } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import { track } from "@/renderer/lib/analytics";
import { centredOn, copyName, offsetBy } from "./frames";
import { undoStackFor, type UndoEntry } from "./undo-stack";

// The canvas's own changes to its frames: copy, cut, paste, duplicate and
// delete, each undoable, and the selection. A frame is a file, so a paste
// writes one (where it lands is placed on the canvas first) and a delete
// moves one to the trash; the watcher brings the canvas the change, as it
// does the agent's.

// A frame as copied: its source then, and where it was.
export type ClipFrame = { name: string; source: string; layout: FrameLayout };

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

// Its frames in reading order: rows, top to bottom, then left to right.
const ROW = 200;
const readingOrder = (a: FrameNode, b: FrameNode) =>
  Math.floor(a.position.y / ROW) - Math.floor(b.position.y / ROW) || a.position.x - b.position.x;

export const useFrameEdits = (workspaceId: string) => {
  const reactFlow = useReactFlow<FrameNode>();
  const store = useStoreApi<FrameNode>();
  const controls = useCanvasControls();
  const queryClient = useQueryClient();

  // Frames to select once they're on the canvas (a paste's, an undone
  // delete's): the watcher brings them a moment after the write.
  const toSelect = useRef<{ ids: string[]; until: number } | null>(null);
  const trySelect = useCallback(() => {
    const want = toSelect.current;
    if (!want) return;
    if (Date.now() > want.until) {
      toSelect.current = null;
      return;
    }
    const { nodeLookup, addSelectedNodes } = store.getState();
    if (!want.ids.every((id) => nodeLookup.has(id))) return;
    toSelect.current = null;
    addSelectedNodes(want.ids);
  }, [store]);
  useEffect(() => store.subscribe(trySelect), [store, trySelect]);

  return useMemo(() => {
    const stack = undoStackFor(workspaceId, report);
    const nodes = () => reactFlow.getNodes();
    const selected = () => nodes().filter((n) => n.selected);

    const select = (names: string[]) => {
      toSelect.current = { ids: names.map(frameNodeId), until: Date.now() + 5000 };
      // Already there (an undone move's): now.
      trySelect();
    };

    const layoutsOf = (names: string[]) => {
      const byName = new Map(nodes().map((n) => [n.data.componentName, frameLayoutOf(n)]));
      return new Map(names.flatMap((name) => (byName.has(name) ? [[name, byName.get(name)!] as const] : [])));
    };

    // Every name a new frame can't have, lower case: the canvas's, and the
    // files' (one the watcher hasn't brought yet).
    const takenNames = () => {
      const files = queryClient.getQueryData<{ name: string }[]>(queryKeys.userComponents.byWorkspace(workspaceId)) ?? [];
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

    // Writes the frames' files, placed first where each goes.
    const create = async (frames: ClipFrame[]) => {
      const cancel = controls.placeFrames(frames.map((f) => ({ ...f.layout, componentName: f.name })));
      const result = await createComponents(
        workspaceId,
        frames.map(({ name, source }) => ({ name, source })),
      );
      if (result.isErr()) {
        cancel();
        throw new Error(result.error.message);
      }
      select(frames.map((f) => f.name));
    };

    // Trashes the frames' files, if each is still `expected` (when given),
    // and gives back what they were.
    const remove = async (names: string[], expected?: Record<string, string>) => {
      const layouts = layoutsOf(names);
      const result = await deleteComponents(workspaceId, names, expected);
      if (result.isErr()) throw new Error(result.error.message);
      const { deleted, failed: refused } = result.value;
      if (refused.length > 0) toast(`Couldn't move ${refused.join(", ")} to the trash`);
      return deleted.map(
        (d): ClipFrame => ({
          ...d,
          layout: layouts.get(d.name) ?? { componentName: d.name, x: 0, y: 0, width: 400, height: 300 },
        }),
      );
    };

    const sourcesByName = (frames: ClipFrame[]) => Object.fromEntries(frames.map((f) => [f.name, f.source]));

    // Frames made (a paste, a duplicate): undone, they go, unless one has
    // changed since (the agent's edit is kept); redone, they're back where
    // they were when undone.
    const created = (frames: ClipFrame[]): UndoEntry => {
      let now = frames;
      return {
        undo: async () => {
          const layouts = layoutsOf(now.map((f) => f.name));
          now = now.map((f) => ({ ...f, layout: layouts.get(f.name) ?? f.layout }));
          await remove(now.map((f) => f.name), sourcesByName(now)).catch(failed("Can't undo: "));
        },
        redo: () => create(now).catch(failed("Can't redo: ")),
      };
    };

    // Frames deleted: undone, they're back where they were.
    const deleted = (frames: ClipFrame[]): UndoEntry => {
      let now = frames;
      return {
        undo: () => create(now).catch(failed("Can't undo: ")),
        redo: async () => {
          now = await remove(now.map((f) => f.name), sourcesByName(now)).catch(failed("Can't redo: "));
        },
      };
    };

    const moved = (moves: FrameMove[]): UndoEntry => {
      const to = (side: "from" | "to") => () => {
        controls.moveFrames(moves.map((m) => ({ componentName: m.componentName, ...m[side] })));
        select(moves.map((m) => m.componentName));
      };
      return { undo: to("from"), redo: to("to") };
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
        const names = frames.map((n) => n.data.componentName);
        let settle!: { resolve: (f: ClipFrame[]) => void; reject: (e: unknown) => void };
        const cutFrames = new Promise<ClipFrame[]>((resolve, reject) => (settle = { resolve, reject }));
        cutFrames.catch(() => {});
        clip = { id: crypto.randomUUID(), workspaceId, text: names.join("\n"), frames: cutFrames, pastes: 0 };
        void stack.perform(async () => {
          try {
            const gone = await remove(names);
            settle.resolve(gone);
            return deleted(gone);
          } catch (e) {
            settle.reject(e);
            throw e;
          }
        });
        edited("cut", frames.length, via);
        return clip;
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
          return created(made);
        });
      },

      // Copies of the selected frames, beside them. The clipboard is left be.
      duplicate(via: Via) {
        const frames = selected();
        if (frames.length === 0) return;
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
          return created(made);
        });
      },

      deleteSelected(via: Via) {
        const names = selected().map((n) => n.data.componentName);
        if (names.length === 0) return;
        void stack.perform(async () => {
          const gone = await remove(names);
          edited("delete", gone.length, via);
          return gone.length > 0 ? deleted(gone) : null;
        });
      },

      recordMoves: (moves: FrameMove[]) => stack.push(moved(moves)),

      undo(via: Via) {
        // A run of arrow keys still settling is a move to undo first.
        controls.flushMoves();
        if (!stack.canUndo) return;
        edited("undo", 1, via);
        void stack.undo();
      },

      redo(via: Via) {
        controls.flushMoves();
        if (!stack.canRedo) return;
        edited("redo", 1, via);
        void stack.redo();
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
  }, [workspaceId, reactFlow, store, controls, queryClient, trySelect]);
};

export type FrameEdits = ReturnType<typeof useFrameEdits>;
