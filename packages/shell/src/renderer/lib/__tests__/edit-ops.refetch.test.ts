import { ok } from "neverthrow";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import type { Style } from "@/shared/design";
import type { EditedElement, EditList } from "@/shared/utils/canvas-edits";
import type { ElementInfo } from "@/agent/protocol";

// A read the last write's end asked for, still on its way when the next
// write lands in the cache: it answers with the API's list from before that
// write, and mustn't replace it.

const server: { gap: number | null } = { gap: null };
const answers: (() => void)[] = [];
const later = <T,>(f: () => T) => new Promise<T>((resolve) => answers.push(() => resolve(f())));
const answer = async () => {
  answers.shift()!();
  await new Promise((r) => setTimeout(r, 0));
};

const base = { gap: 0 } as Style;
const element = { ref: { loc: "L0", index: 0, path: [0], tag: "div" } } as ElementInfo;
const edit = (gap: number): EditedElement => ({ id: 1, componentName: "Card", element, name: "div", text: false, base, now: { ...base, gap }, seen: null });

vi.mock("../api", () => ({
  putEdit: vi.fn((_ws: string, input: Omit<EditedElement, "id">) =>
    later(() => {
      server.gap = input.now.gap;
      return ok(edit(input.now.gap));
    }),
  ),
  // The list as the API has it when the read is made.
  listEdits: vi.fn(() => {
    const now = server.gap;
    return later(() => ok({ edits: now === null ? [] : [edit(now)], applied: [] } satisfies EditList));
  }),
  removeEdits: vi.fn(),
  releaseApplied: vi.fn(),
  watchEdits: vi.fn(() => () => {}),
}));

const { saveEdit } = await import("../edit-ops");
const { queryKeys } = await import("../query-keys");
const { listEdits } = await import("../api");

test("a read on its way when a write lands doesn't bring back the value it replaced", async () => {
  const ws = crypto.randomUUID();
  const queryKey = queryKeys.edits.byWorkspace(ws);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<EditList>(queryKey, { edits: [], applied: [] });
  const observer = new QueryObserver(queryClient, { queryKey, queryFn: async () => (await listEdits(ws))._unsafeUnwrap(), staleTime: Infinity });
  const stop = observer.subscribe(() => {});
  const gap = () => queryClient.getQueryData<EditList>(queryKey)?.edits[0]?.now.gap;

  saveEdit(queryClient, ws, { ...edit(2), id: undefined } as unknown as Omit<EditedElement, "id">);
  await answer(); // gap 2 is saved: its end reads the list again.
  expect(answers).toHaveLength(1);
  saveEdit(queryClient, ws, { ...edit(3), id: undefined } as unknown as Omit<EditedElement, "id">);
  expect(gap()).toBe(3);
  await answer(); // That read answers: gap 2.
  expect(gap()).toBe(3);
  await answer(); // gap 3 is saved, and read again.
  await answer();
  expect(gap()).toBe(3);
  stop();
});
