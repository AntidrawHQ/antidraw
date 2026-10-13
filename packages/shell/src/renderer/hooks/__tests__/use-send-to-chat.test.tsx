// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { Comment } from "@/main/api";
import { useWorkspaceStore } from "@/renderer/store/workspace";

// A comment send goes where its message was written for: the workspace and
// chat open when Send was pressed, whatever is open by the time it's sent.

const sent = vi.hoisted(() => [] as { workspaceId: string; conversationId: string }[]);
const created = vi.hoisted(() => [] as string[]);
const prompted = vi.hoisted(() => ({ release: () => {} }));
vi.mock("@/renderer/lib/claude-code-ops", () => ({
  useCreateConversation: () => ({
    isPending: false,
    mutateAsync: async ({ workspaceId }: { workspaceId: string }) => {
      created.push(workspaceId);
      return { id: `new-in-${workspaceId}` };
    },
  }),
  useSendMessage: () => ({ isPending: false, mutateAsync: async (m: (typeof sent)[number]) => void sent.push(m) }),
  useGenerateTitle: () => ({ mutate: () => {} }),
}));
vi.mock("@/renderer/lib/api", async (actual) => ({
  ...(await actual<typeof import("@/renderer/lib/api")>()),
  // The message is written while the user switches chats.
  commentsPrompt: () =>
    new Promise((resolve) => {
      prompted.release = () => resolve({ isErr: () => false, isOk: () => true, value: { ids: [1], prompt: "<canvas-comments>" } });
    }),
}));
vi.mock("@/renderer/inspector/bridge", () => ({ frameUrl: () => null, getElementContext: async () => [] }));

const { useSendComments } = await import("@/renderer/lib/comment-ops");

const draft = { id: 1, componentName: "Card", text: "bolder", element: null } as unknown as Comment;

const run = async (open: { workspace: string; chat: string | null }, then: { workspace: string; chat: string | null }) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspaceStore.setState({ activeWorkspaceId: open.workspace, activeConversationId: open.chat });
  let send!: ReturnType<typeof useSendComments>["send"];
  const Use = () => {
    send = useSendComments(open.workspace).send;
    return null;
  };
  document.body.innerHTML = `<div id="root"></div>`;
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<QueryClientProvider client={new QueryClient()}><Use /></QueryClientProvider>));
  let sending!: Promise<unknown>;
  await act(async () => {
    sending = send({ drafts: [draft] });
  });
  useWorkspaceStore.setState({ activeWorkspaceId: then.workspace, activeConversationId: then.chat });
  await act(async () => {
    prompted.release();
    await sending;
  });
  act(() => root.unmount());
};

it("sends into the chat open at Send, not one switched to while the message is written", async () => {
  sent.length = 0;
  await run({ workspace: "w1", chat: "a" }, { workspace: "w1", chat: "b" });
  expect(sent).toMatchObject([{ workspaceId: "w1", conversationId: "a" }]);
});

it("makes a new chat in the workspace open at Send, and leaves the one switched to as it is", async () => {
  sent.length = 0;
  created.length = 0;
  await run({ workspace: "w1", chat: null }, { workspace: "w2", chat: "c" });
  expect([created, sent]).toMatchObject([["w1"], [{ workspaceId: "w1", conversationId: "new-in-w1" }]]);
  expect(useWorkspaceStore.getState().activeConversationId).toBe("c");
});
