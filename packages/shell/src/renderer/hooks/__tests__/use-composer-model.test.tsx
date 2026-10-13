// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { ConversationWithMessages } from "@/main/api";
import { DEFAULT_MODELS } from "@/renderer/components/modelPickerShared";
import { useComposerModel } from "../use-composer-model";

// A pick not yet sent, as every send into the chat sees it: the composer's
// and the comments' (CommentFlow has its own instance of the hook).

vi.mock("@/renderer/lib/api", async (actual) => ({
  ...(await actual<typeof import("@/renderer/lib/api")>()),
  setPreference: async () => ({ isErr: () => false }),
  getPreference: async () => ({ isErr: () => false, value: null }),
  getSupportedModels: async () => ({ isErr: () => false, value: DEFAULT_MODELS }),
}));

it("shares a chat's un-sent pick between every instance, over what the chat last ran on", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const chat = { selectedModel: DEFAULT_MODELS[0]!.value, selectedEffort: "low" } as ConversationWithMessages;
  const seen: Record<string, ReturnType<typeof useComposerModel>> = {};
  const Use = ({ name }: { name: string }) => {
    seen[name] = useComposerModel("chat-1", chat);
    return null;
  };
  document.body.innerHTML = `<div id="root"></div>`;
  const root = createRoot(document.getElementById("root")!);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Use name="composer" />
        <Use name="comments" />
      </QueryClientProvider>,
    ),
  );
  const other = DEFAULT_MODELS.find((m) => m.value !== chat.selectedModel && m.supportedEffortLevels?.includes("high"))!;
  await act(async () => {
    seen.composer!.handleModelChange(other.value, other);
    seen.composer!.handleEffortChange("high");
  });
  expect([seen.comments!.selectedModelId, seen.comments!.effort]).toEqual([other.value, "high"]);
  act(() => root.unmount());
});
