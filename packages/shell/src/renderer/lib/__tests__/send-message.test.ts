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
    deliveredAt: null,
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

    // The bubble is there, marked streaming, and carries the id the backend
    // will use so the persisted row replaces it rather than doubling it.
    const bubble = detail(qc, id)!.messages[1]!;
    expect(bubble.id).toBe(vars.userMessageId);
    expect(bubble.seq).toBe(PENDING_SEQ);
    expect(detail(qc, id)!.streamStatus).toBe("streaming");

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
      [vars.userMessageId, "someone-else"],
    );
    mockSend.mockResolvedValue(
      err({ status: 500 as const, code: "NETWORK_ERROR", message: "offline" }),
    );

    await expect(
      executeMutation(qc, sendMessageMutationOptions(qc), vars),
    ).rejects.toThrow("offline");

    expect(detail(qc, id)!.messages).toEqual(before);
    expect(detail(qc, id)!.streamStatus).toBe("idle");
    // Only this send's mark goes; a concurrent one must survive.
    expect(
      qc.getQueryData<string[]>(queryKeys.conversations.queuedMessageIds(id)),
    ).toEqual(["someone-else"]);
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
