import { describe, test, expect, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { MutationOptions } from "@tanstack/react-query";
import type { UUID } from "node:crypto";
import { ok, err } from "neverthrow";
import type { ConversationWithMessages, Message } from "@/main/api";
import { createUserSDKMessage } from "@/shared/utils/message";
import { queryKeys } from "../query-keys";

// Only the HTTP call is faked. Every callback under test is the real one.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, sendMessage: vi.fn() };
});

const { sendMessage } = await import("../api");
const { sendMessageMutationOptions, PENDING_SEQ } = await import(
  "../claude-code-ops"
);
const mockSend = vi.mocked(sendMessage);

// Upstream's own idiom for driving a mutation with no renderer
// (query/packages/query-core/src/__tests__/utils.ts:13-21). It runs the real
// lifecycle: onMutate -> mutationFn -> onSuccess/onError -> onSettled.
const executeMutation = <V,>(
  queryClient: QueryClient,
  options: MutationOptions<any, any, V, any>,
  variables: V,
) =>
  queryClient.getMutationCache().build(queryClient, options).execute(variables);

let counter = 0;
const freshId = () => `conversation-${counter++}`;

const persisted = (seq: number, text: string): Message => {
  const id = crypto.randomUUID();
  return {
    id,
    conversationId: "c",
    messageType: "user_prompt",
    sdkMessage: createUserSDKMessage({ text, uuid: id as UUID }),
    seq,
    createdAt: new Date(0),
  };
};

const seedCache = (qc: QueryClient, id: string, messages: Message[]) =>
  qc.setQueryData<ConversationWithMessages>(queryKeys.conversations.detail(id), {
    id, workspaceId: "w", claudeCodeSessionId: null, title: null, summary: null,
    selectedModel: null, selectedEffort: null,
    createdAt: new Date(0), updatedAt: new Date(0),
    streamStatus: "idle", messages,
  });

const detail = (qc: QueryClient, id: string) =>
  qc.getQueryData<ConversationWithMessages>(queryKeys.conversations.detail(id));

let qc: QueryClient;
const send = (conversationId: string) => ({
  message: "hello",
  workspaceId: "w",
  conversationId,
  userMessageId: crypto.randomUUID(),
});

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  mockSend.mockReset();
});

describe("the send's optimistic protocol", () => {
  test("puts a bubble in the transcript before the request resolves", async () => {
    const id = freshId();
    seedCache(qc, id, [persisted(1, "earlier")]);
    let release!: () => void;
    mockSend.mockImplementation(
      () => new Promise((r) => { release = () => r(ok({ conversationId: id })); }),
    );
    const vars = send(id);

    const running = executeMutation(qc, sendMessageMutationOptions(qc), vars);
    await vi.waitFor(() => expect(detail(qc, id)!.messages).toHaveLength(2));

    // The bubble is there and carries the id the backend will use, so the
    // persisted row replaces it rather than doubling it. The status is not
    // touched yet: a send says "streaming" only once the backend has
    // accepted it (onSuccess), never on a guess it might have to take back.
    const bubble = detail(qc, id)!.messages[1]!;
    expect(bubble.id).toBe(vars.userMessageId);
    expect(bubble.seq).toBe(PENDING_SEQ);
    expect(detail(qc, id)!.streamStatus).toBe("idle");

    release();
    await running;
  });

  test("a failed send rolls the transcript back and drops the queue mark", async () => {
    const id = freshId();
    const before = [persisted(1, "earlier")];
    seedCache(qc, id, before);
    const vars = send(id);
    qc.setQueryData<string[]>(
      queryKeys.conversations.queuedMessageIds(id),
      [vars.userMessageId],
    );
    mockSend.mockResolvedValue(
      err({ status: 500 as const, code: "NETWORK_ERROR", message: "offline" }),
    );

    await expect(
      executeMutation(qc, sendMessageMutationOptions(qc), vars),
    ).rejects.toThrow("offline");

    expect(detail(qc, id)!.messages).toEqual(before);
    expect(detail(qc, id)!.streamStatus).toBe("idle");
    expect(
      qc.getQueryData<string[]>(queryKeys.conversations.queuedMessageIds(id)),
    ).toEqual([]);
  });

  test("a failed send takes back only its own bubble, not what the turn streamed meanwhile", async () => {
    const id = freshId();
    const before = [persisted(1, "earlier")];
    seedCache(qc, id, before);
    qc.setQueryData<ConversationWithMessages>(
      queryKeys.conversations.detail(id),
      (old) => ({ ...old!, streamStatus: "streaming" }),
    );
    const vars = send(id);

    // The interleaving the snapshot restore got wrong: a turn is running,
    // and while this POST is out it persists a row. That lands after
    // onMutate's snapshot and before onError.
    const streamed = persisted(2, "arrived while the POST was out");
    mockSend.mockImplementation(async () => {
      qc.setQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(id),
        (old) => ({ ...old!, messages: [...old!.messages, streamed] }),
      );
      return err({ status: 500 as const, code: "NETWORK_ERROR", message: "offline" });
    });

    await expect(
      executeMutation(qc, sendMessageMutationOptions(qc), vars),
    ).rejects.toThrow("offline");

    const after = detail(qc, id)!;
    expect(after.messages.map((m) => m.id)).toEqual([before[0]!.id, streamed.id]);
    expect(after.streamStatus).toBe("streaming");
  });

  test("a failed send leaves the status to the stream", async () => {
    const id = freshId();
    seedCache(qc, id, [persisted(1, "earlier")]);
    const vars = send(id);
    // The loop died while the POST was out. That is the stream's word; a
    // send never wrote a status of its own, so it has nothing to restore.
    mockSend.mockImplementation(async () => {
      qc.setQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(id),
        (old) => ({ ...old!, streamStatus: "error" }),
      );
      return err({ status: 500 as const, code: "NETWORK_ERROR", message: "offline" });
    });

    await expect(
      executeMutation(qc, sendMessageMutationOptions(qc), vars),
    ).rejects.toThrow("offline");

    expect(detail(qc, id)!.streamStatus).toBe("error");
    expect(detail(qc, id)!.messages.map((m) => m.seq)).toEqual([1]);
  });

  test("a failed send does not take back a running the CLI reported meanwhile", async () => {
    const id = freshId();
    seedCache(qc, id, [persisted(1, "earlier")]);
    const vars = send(id);
    // Idle with an earlier send un-acked: the CLI reports idle for a message
    // it has not parsed yet, then starts that turn while this POST is out.
    // Had onMutate written "streaming" itself, this `running` would be
    // indistinguishable from it and a snapshot restore would write idle over
    // a live turn — and the idle handler would then skip its reconciling
    // refetch at the end of that turn, having never seen it streaming.
    mockSend.mockImplementation(async () => {
      qc.setQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(id),
        (old) => ({ ...old!, streamStatus: "streaming" }),
      );
      return err({ status: 500 as const, code: "NETWORK_ERROR", message: "offline" });
    });

    await expect(
      executeMutation(qc, sendMessageMutationOptions(qc), vars),
    ).rejects.toThrow("offline");

    expect(detail(qc, id)!.streamStatus).toBe("streaming");
    expect(detail(qc, id)!.messages.map((m) => m.seq)).toEqual([1]);
  });

  test("a bubble the stream already replaced is not re-appended on success", async () => {
    const id = freshId();
    seedCache(qc, id, []);
    const vars = send(id);
    mockSend.mockImplementation(async () => {
      // The SSE race the onSuccess comment describes: the persisted row lands
      // while the POST is still open, replacing the bubble at its real seq.
      qc.setQueryData<ConversationWithMessages>(
        queryKeys.conversations.detail(id),
        (old) => ({
          ...old!,
          messages: [{ ...old!.messages[0]!, seq: 12 }],
        }),
      );
      return ok({ conversationId: id });
    });

    await executeMutation(qc, sendMessageMutationOptions(qc), vars);

    const rows = detail(qc, id)!.messages;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seq).toBe(12); // the real one, not the placeholder
  });

  test("refuses to send into a conversation that is not in the cache", async () => {
    const id = freshId();
    await expect(
      executeMutation(qc, sendMessageMutationOptions(qc), send(id)),
    ).rejects.toThrow("Conversation not found in cache");
    expect(mockSend).not.toHaveBeenCalled();
  });
});
