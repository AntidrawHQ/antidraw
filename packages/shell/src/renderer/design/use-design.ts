import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ElementInfo, PreviewItem } from "@/agent/protocol";
import { changesOf, previewCss, previewText, type Change, type Style } from "@/shared/design";
import type { EditedElement, EditList } from "@/shared/utils/canvas-edits";
import { editsPrompt } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import { editsSettled, elementKey, keyOf, resetEdits, saveEdit, stopPreviewing, useEdits, useEditsChanged } from "@/renderer/lib/edit-ops";
import { frameUrl, getElementContext, getStyle, previewStyles } from "@/renderer/inspector/bridge";
import { useInspectorStore } from "@/renderer/inspector/store";
import { describeContext, describeLastSeen, usableContext } from "@/renderer/inspector/tags";
import { useCommentStore } from "@/renderer/comments/store";
import { useSendToChat } from "@/renderer/hooks/use-send-to-chat";
import { useComposerModel } from "@/renderer/hooks/use-composer-model";
import { useConversationMessages } from "@/renderer/lib/claude-code-ops";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useDesignStore } from "./store";

// The Design panel's state and what it does, for the panel (RightPanel) and
// the canvas's edit bar (EditBar): the selected element's styles, every
// edit not yet applied and the sets being applied, and Edit, Undo, Reset,
// Apply and Stop. Edits live in the app's API (lib/edit-ops); the canvas
// shows them (DesignSync).

// As the change list names an element: "button#buy.cta".
export const elementLabel = (info: ElementInfo) => info.tag + (info.id ? `#${info.id}` : "") + (info.classes[0] ? `.${info.classes[0]}` : "");

export type ElementChange = Change & { edit: EditedElement };

const EMPTY: EditList = { edits: [], applied: [] };

export const useDesign = () => {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data = EMPTY } = useEdits(workspaceId);
  const selection = useInspectorStore((s) => s.selection);
  const read = useDesignStore((s) => s.read);

  const key = selection && elementKey(selection.frame, selection.info.ref);
  const pending = key ? data.edits.find((e) => keyOf(e) === key) : undefined;
  // What the selected element had before it was edited, and has now.
  const current = pending ?? (read && read.key === key ? { base: read.style, now: read.style, text: read.text, seen: read.seen } : null);

  const set = (patch: Partial<Style>) => {
    if (!workspaceId || !selection || !current) return;
    saveEdit(queryClient, workspaceId, {
      componentName: selection.frame,
      element: selection.info,
      name: elementLabel(selection.info),
      text: current.text,
      base: current.base,
      now: { ...current.now, ...patch },
      seen: current.seen,
    });
  };

  const changes: ElementChange[] = data.edits.flatMap((edit) => changesOf(edit.base, edit.now).map((c) => ({ ...c, edit })));
  const revert = (c: ElementChange) => {
    if (!workspaceId) return;
    const back = Object.fromEntries(c.group.keys.map((k) => [k, c.edit.base[k]]));
    saveEdit(queryClient, workspaceId, { ...c.edit, now: { ...c.edit.now, ...back } });
  };
  const revertEdits = (edits: EditedElement[]) => {
    if (workspaceId) for (const edit of edits) saveEdit(queryClient, workspaceId, { ...edit, now: edit.base });
  };
  const reset = () => workspaceId && resetEdits(queryClient, workspaceId);
  const release = (setId: number) => workspaceId && stopPreviewing(queryClient, workspaceId, setId);

  // Apply: to the chat that's open, with its model and effort, as its
  // composer's send would; with none open, to a new one. The edits are the
  // agent's at once: off the list, shown as a set being applied, so editing
  // goes on meanwhile.
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const { data: activeConversation } = useConversationMessages(activeConversationId);
  const composer = useComposerModel(activeConversationId, activeConversation);
  const sendToChat = useSendToChat();
  const [describing, setDescribing] = useState(false);
  const apply = async () => {
    if (!workspaceId) return;
    // Where it goes is fixed now: switching chat or workspace while it's
    // described doesn't move it.
    const target = { workspaceId, conversationId: activeConversationId ?? null };
    const { selectedModelId: model, effort } = composer;
    setDescribing(true);
    try {
      await editsSettled(workspaceId);
      const queryKey = queryKeys.edits.byWorkspace(workspaceId);
      const edits = queryClient.getQueryData<EditList>(queryKey)?.edits.filter((e) => e.id > 0) ?? [];
      if (!edits.length) return;
      const context = edits.map((e) => {
        const seen = usableContext(e.seen);
        return {
          id: e.id,
          block: seen ? describeContext(seen) : describeLastSeen({ frame: e.componentName, info: e.element }),
          preview: frameUrl(e.componentName),
          frame: seen?.viewport.join("×") ?? null,
        };
      });
      const result = await editsPrompt(workspaceId, { context });
      if (result.isErr()) throw new Error(result.error.message);
      const { ids, prompt } = result.value;
      const taken = edits.filter((e) => ids.includes(e.id));
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<EditList>(
        queryKey,
        (old) =>
          old && {
            edits: old.edits.filter((e) => !ids.includes(e.id)),
            applied: [...old.applied, { id: -Date.now(), conversationId: "", edits: taken }],
          },
      );
      setDescribing(false);
      await sendToChat
        .send({
          prompt,
          model,
          effort,
          editIds: ids,
          target,
          title: taken.flatMap((e) => changesOf(e.base, e.now).map((c) => `${e.name} ${c.group.label}: ${c.from} → ${c.to}`)).join("\n"),
        })
        .finally(() => void queryClient.invalidateQueries({ queryKey }));
    } catch (e) {
      console.error(e);
    } finally {
      setDescribing(false);
    }
  };

  return {
    workspaceId,
    selection,
    key,
    current,
    set,
    edits: data.edits,
    applied: data.applied,
    changes,
    revert,
    revertEdits,
    reset,
    apply,
    applying: describing || sendToChat.isPending,
    release,
  };
};

// The pending edits the canvas can't show: their frame says it can't find
// the element, or their component's frame isn't on the canvas.
export const useNotShowing = (edits: EditedElement[]) => {
  const missing = useInspectorStore((s) => s.missing);
  const onCanvas = useCommentStore((s) => s.onCanvas);
  return edits.filter((e) => !onCanvas(e.componentName) || missing[e.componentName]?.includes(`e${e.id}`));
};

// What the canvas does for the panel, mounted with it: each frame shows its
// edits (the sets being applied, then those pending, which win), and the
// selected element is read from its frame, when there's no edit of it to
// start from.
export const DesignSync = () => {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  useEditsChanged(workspaceId);
  const { data = EMPTY } = useEdits(workspaceId);

  const shown = useRef(new Set<string>());
  useEffect(() => {
    const byFrame = new Map<string, PreviewItem[]>();
    const add = (key: string, e: EditedElement) =>
      byFrame.set(e.componentName, [
        ...(byFrame.get(e.componentName) ?? []),
        { key, ref: e.element.ref, css: previewCss(e.base, e.now), text: previewText(e.base, e.now) },
      ]);
    for (const set of data.applied) for (const e of set.edits) add(`a${set.id}-${e.id}`, e);
    for (const e of data.edits) add(`e${e.id}`, e);
    for (const frame of shown.current) if (!byFrame.has(frame)) previewStyles(frame, []);
    for (const [frame, items] of byFrame) previewStyles(frame, items);
    shown.current = new Set(byFrame.keys());
  }, [data]);
  useEffect(() => () => shown.current.forEach((frame) => previewStyles(frame, [])), []);

  // Read again whenever there's no edit of it to start from: newly selected,
  // or its edits undone or applied, which the frame now shows otherwise, or
  // a set on its frame let go (the frame shows the code's now). Only once its
  // frame really is ready: the page's root standing in can't find it.
  const selection = useInspectorStore((s) => s.selection);
  const key = selection && elementKey(selection.frame, selection.info.ref);
  const edited = !!key && data.edits.some((e) => keyOf(e) === key);
  const ready = useInspectorStore((s) => !!selection && !!s.frames[selection.frame]?.ready && !s.frames[selection.frame]?.provisional);
  const sets = data.applied
    .filter((set) => set.edits.some((e) => e.componentName === selection?.frame))
    .map((set) => set.id)
    .join();
  useEffect(() => {
    const { setRead } = useDesignStore.getState();
    const pick = useInspectorStore.getState().selection;
    if (!pick || !key) return setRead(null);
    if (edited || !ready) return;
    let stale = false;
    void Promise.all([getStyle(pick.frame, pick.info.ref), getElementContext([pick])]).then(([style, [seen]]) => {
      // Not found (the frame's busy, or it went): what was read stays.
      if (stale || !style) return;
      setRead({ key, style: style.style, text: style.text, seen: seen ?? null });
    });
    return () => {
      stale = true;
    };
  }, [key, edited, ready, sets]);

  return null;
};
