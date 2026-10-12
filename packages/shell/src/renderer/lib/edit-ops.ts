import { useEffect } from "react";
import { skipToken, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Result } from "neverthrow";
import type { ElementRef } from "@/agent/protocol";
import { same } from "@/shared/design";
import type { EditedElement, EditList } from "@/shared/utils/canvas-edits";
import { listEdits, putEdit, releaseApplied, removeEdits, watchEdits } from "./api";
import { queryKeys } from "./query-keys";

// The Design panel's edits, kept by the app's API in memory (GET
// /workspaces/:id/edits) and read from there by whatever shows them. Each
// write lands in the cache at once, so a drag is as quick as the page, and
// goes to the API after: one at a time per element, the latest value when
// the last one's done.

export type EditInput = Omit<EditedElement, "id">;

const unwrap = async <T>(result: Promise<Result<T, { message: string }>>) => {
  const r = await result;
  if (r.isErr()) throw new Error(r.error.message);
  return r.value;
};

export const useEdits = (workspaceId: string | null) =>
  useQuery({
    queryKey: queryKeys.edits.byWorkspace(workspaceId),
    queryFn: workspaceId ? () => unwrap(listEdits(workspaceId)) : skipToken,
  });

// Which element an edit is on, as the API matches them (and the inspector's
// samePick): by its source location, or where it has none, its path.
export const elementKey = (componentName: string, ref: ElementRef) =>
  JSON.stringify(ref.loc !== null ? [componentName, ref.loc, ref.index] : [componentName, null, ref.index, ref.path]);
export const keyOf = (e: Pick<EditedElement, "componentName" | "element">) => elementKey(e.componentName, e.element.ref);

/* ── Writes ────────────────────────────────────────────────────────────── */

// Per workspace, the writes on their way: while any is, the stream's news
// waits (a refetch then would bring back what they're replacing), and once
// none is, the list is read again.
const inFlight = new Map<string, number>();
const settledWaiters = new Map<string, (() => void)[]>();
// Per element, the value to write once the one on its way is done.
const queued = new Map<string, { next: EditInput | null }>();
// Ids for edits the API hasn't numbered yet.
let tempId = -1;

const begin = (workspaceId: string) => inFlight.set(workspaceId, (inFlight.get(workspaceId) ?? 0) + 1);
const end = (queryClient: QueryClient, workspaceId: string) => {
  const left = (inFlight.get(workspaceId) ?? 1) - 1;
  if (left > 0) return void inFlight.set(workspaceId, left);
  inFlight.delete(workspaceId);
  void queryClient.invalidateQueries({ queryKey: queryKeys.edits.byWorkspace(workspaceId) });
  for (const resolve of settledWaiters.get(workspaceId) ?? []) resolve();
  settledWaiters.delete(workspaceId);
};

// Once every write so far has landed.
export const editsSettled = (workspaceId: string) =>
  inFlight.get(workspaceId)
    ? new Promise<void>((resolve) => settledWaiters.set(workspaceId, [...(settledWaiters.get(workspaceId) ?? []), resolve]))
    : Promise.resolve();

const update = (queryClient: QueryClient, workspaceId: string, f: (list: EditList) => EditList) =>
  queryClient.setQueryData<EditList>(queryKeys.edits.byWorkspace(workspaceId), (old) => f(old ?? { edits: [], applied: [] }));

// An element's edits as the panel has them now: back where it started, it
// has none.
export const saveEdit = (queryClient: QueryClient, workspaceId: string, input: EditInput) => {
  const key = keyOf(input);
  update(queryClient, workspaceId, (list) => {
    const was = list.edits.find((e) => keyOf(e) === key);
    if (same(input.base, input.now)) return { ...list, edits: list.edits.filter((e) => e !== was) };
    const edit = was ? { ...was, ...input, base: was.base, seen: was.seen } : { ...input, id: tempId-- };
    return { ...list, edits: was ? list.edits.map((e) => (e === was ? edit : e)) : [...list.edits, edit] };
  });

  const slot = `${workspaceId}\n${key}`;
  const q = queued.get(slot);
  if (q) return void (q.next = input);
  const mine = { next: null as EditInput | null };
  queued.set(slot, mine);
  const write = async (value: EditInput) => {
    begin(workspaceId);
    try {
      const saved = await unwrap(putEdit(workspaceId, value));
      // The API's number for one that had none here.
      if (saved)
        update(queryClient, workspaceId, (list) => ({
          ...list,
          edits: list.edits.map((e) => (keyOf(e) === key && e.id < 0 ? { ...e, id: saved.id } : e)),
        }));
    } catch (e) {
      console.error(e);
    } finally {
      const next = mine.next;
      mine.next = null;
      if (next) void write(next);
      else queued.delete(slot);
      end(queryClient, workspaceId);
    }
  };
  void write(input);
};

// Every edit not yet applied, undone: Reset.
export const resetEdits = (queryClient: QueryClient, workspaceId: string) => {
  update(queryClient, workspaceId, (list) => ({ ...list, edits: [] }));
  begin(workspaceId);
  void unwrap(removeEdits(workspaceId))
    .catch(console.error)
    .finally(() => end(queryClient, workspaceId));
};

// A set being applied, no longer shown.
export const stopPreviewing = (queryClient: QueryClient, workspaceId: string, setId: number) => {
  update(queryClient, workspaceId, (list) => ({ ...list, applied: list.applied.filter((s) => s.id !== setId) }));
  begin(workspaceId);
  void unwrap(releaseApplied(workspaceId, setId))
    .catch(console.error)
    .finally(() => end(queryClient, workspaceId));
};

/* ── News ──────────────────────────────────────────────────────────────── */

// One stream per workspace, however many places watch its edits: the last
// to unmount closes it.
const watching = new Map<string, { users: number; stop: () => void }>();

// The edits' news, from the workspace's edits event stream: any write, from
// here or elsewhere, an Apply, a set let go when its chat's turn ended. Each
// refetches, unless writes from here are on their way: their end does.
export const useEditsChanged = (workspaceId: string | null) => {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!workspaceId) return;
    const queryKey = queryKeys.edits.byWorkspace(workspaceId);
    const watch = watching.get(workspaceId) ?? {
      users: 0,
      stop: watchEdits(workspaceId, () => {
        if (!inFlight.get(workspaceId)) void queryClient.invalidateQueries({ queryKey });
      }),
    };
    watch.users++;
    watching.set(workspaceId, watch);
    return () => {
      if (--watch.users > 0) return;
      watch.stop();
      watching.delete(workspaceId);
    };
  }, [workspaceId, queryClient]);
};
