import { ok, err } from "neverthrow";
import { conversationEvents } from "@/main/lib/conversation-store";
import { editEvents } from "@/main/lib/edit-events";
import { same } from "@/shared/design";
import {
  describeEdits,
  type AppliedSet,
  type EditContext,
  type EditedElement,
  type EditList,
} from "@/shared/utils/canvas-edits";

// The Design panel's edits, per workspace, in memory only: they're a
// preview until Apply hands them to a chat, and a quit or a reload of the
// app lets them go. Both the canvas and anything else that shows them read
// them from here (GET /workspaces/:id/edits), and hear of changes on its
// event stream.

const workspaces = new Map<string, EditList>();
let nextEdit = 1;
let nextSet = 1;

const of = (workspaceId: string) => {
  let list = workspaces.get(workspaceId);
  if (!list) workspaces.set(workspaceId, (list = { edits: [], applied: [] }));
  return list;
};

const changed = (workspaceId: string) => editEvents.emit("changed", workspaceId);

const notFound = (message: string) => err({ status: 404 as const, code: "NOT_FOUND", message });

// Two edits are on the same element when its frame would find the same one
// (the renderer's samePick).
const sameElement = (a: Pick<EditedElement, "componentName" | "element">, b: Pick<EditedElement, "componentName" | "element">) =>
  a.componentName === b.componentName &&
  a.element.ref.loc === b.element.ref.loc &&
  a.element.ref.index === b.element.ref.index &&
  (a.element.ref.loc !== null || a.element.ref.path.join() === b.element.ref.path.join());

export const listEdits = (workspaceId: string) => ok(of(workspaceId));

export type EditInput = Omit<EditedElement, "id">;

// An element's edits as the panel has them now. Its first edit keeps what
// it was before (`base`, `seen`); one back where it started is no edit.
// Resolves to the element's edit, or null when there's none left.
export const putEdit = (workspaceId: string, input: EditInput) => {
  const list = of(workspaceId);
  const was = list.edits.find((e) => sameElement(e, input));
  const edit: EditedElement = was
    ? { ...was, element: input.element, name: input.name, text: input.text, now: input.now }
    : { ...input, id: nextEdit++ };
  const others = list.edits.filter((e) => e !== was);
  const kept = !same(edit.base, edit.now);
  list.edits = kept ? (was ? list.edits.map((e) => (e === was ? edit : e)) : [...others, edit]) : others;
  changed(workspaceId);
  return ok(kept ? edit : null);
};

// One element's edits undone, or (no id) all of them: Reset.
export const removeEdits = (workspaceId: string, id?: number) => {
  const list = of(workspaceId);
  if (id !== undefined && !list.edits.some((e) => e.id === id)) return notFound("No such edit");
  list.edits = id === undefined ? [] : list.edits.filter((e) => e.id !== id);
  changed(workspaceId);
  return ok(true);
};

// The message that applies these edits. Reads only: the send is POST
// /chat/message, which marks them (markEditsApplied). The canvas describes
// the elements (`context`): only the frames can.
export const describePendingEdits = (workspaceId: string, context: EditContext[]) => {
  const byId = new Map(context.map((c) => [c.id, c]));
  const edits = of(workspaceId).edits.filter((e) => byId.has(e.id));
  if (!edits.length) return notFound("No edits to apply");
  return ok({ ids: edits.map((e) => e.id), prompt: describeEdits(edits.map((e) => ({ ...e, ...byId.get(e.id)! }))) });
};

// The edits a message carries, handed to its chat: off the list, and shown
// as a set being applied until the chat's turn ends. All or none: if any
// isn't on the list any more (undone, or another Apply took it), the send
// must not go.
export const markEditsApplied = (workspaceId: string, conversationId: string, ids: number[]) => {
  const list = of(workspaceId);
  const taken = list.edits.filter((e) => ids.includes(e.id));
  if (taken.length !== new Set(ids).size)
    return err({ status: 409 as const, code: "EDITS_CHANGED", message: "Some of these edits were already applied or undone" });
  list.edits = list.edits.filter((e) => !taken.includes(e));
  list.applied = [...list.applied, { id: nextSet++, conversationId, edits: taken } satisfies AppliedSet];
  changed(workspaceId);
  return ok(true);
};

// A set no longer shown: × on it, or its chat's turn ended.
export const releaseApplied = (workspaceId: string, setId: number) => {
  const list = of(workspaceId);
  if (!list.applied.some((s) => s.id === setId)) return notFound("No such set");
  list.applied = list.applied.filter((s) => s.id !== setId);
  changed(workspaceId);
  return ok(true);
};

// Once a chat's turn ends its sets are in the code, which the frames show.
conversationEvents.on("state", (conversationId, { state }) => {
  if (state !== "idle") return;
  for (const [workspaceId, list] of workspaces) {
    if (!list.applied.some((s) => s.conversationId === conversationId)) continue;
    list.applied = list.applied.filter((s) => s.conversationId !== conversationId);
    changed(workspaceId);
  }
});
