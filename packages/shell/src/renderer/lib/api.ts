import type {
  ChatMessageResponse,
  Conversation,
  ConversationWithMessages,
  CreateWorkspaceResponse,
  DevServerInfo,
  DevServerState,
  Workspace,
} from "@/main/api";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { ok, err } from "neverthrow";

// ============================================================================
// Workspace API
// ============================================================================

export async function* createWorkspace(
  name: string
): AsyncGenerator<CreateWorkspaceResponse> {
  const stream = new ReadableStream<CreateWorkspaceResponse>({
    start(controller) {
      fetchEventSource("antidraw://_internal/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),

        onmessage: (ev) => {
          controller.enqueue(JSON.parse(ev.data) as CreateWorkspaceResponse);
        },
        onerror: (error) => controller.error(error),
        onclose: () => controller.close(),
      });
    },
  });

  yield* stream;
}

export const listWorkspaces = async () => {
  try {
    const response = await fetch("antidraw://_internal/workspaces");

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: Workspace[] = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to list workspaces",
    });
  }
};

export const getWorkspace = async (id: string) => {
  try {
    const response = await fetch(`antidraw://_internal/workspaces/${id}`);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: Workspace = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to get workspace",
    });
  }
};

export const deleteWorkspace = async (id: string) => {
  try {
    const response = await fetch(`antidraw://_internal/workspaces/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { deleted: boolean } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to delete workspace",
    });
  }
};

// ============================================================================
// Dev Server API
// ============================================================================

// Re-export types from backend for convenience
export type { DevServerState, DevServerInfo } from "@/main/api";

export const startDevServer = async (workspaceId: string) => {
  try {
    const response = await fetch(
      `antidraw://_internal/workspaces/${workspaceId}/dev-server`,
      { method: "POST" }
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: DevServerState = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to start dev server",
    });
  }
};

export const stopDevServer = async (workspaceId: string) => {
  try {
    const response = await fetch(
      `antidraw://_internal/workspaces/${workspaceId}/dev-server`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { stopped: boolean } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to stop dev server",
    });
  }
};

export const getDevServerStatus = async (workspaceId: string) => {
  try {
    const response = await fetch(
      `antidraw://_internal/workspaces/${workspaceId}/dev-server`
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: DevServerInfo = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to get dev server status",
    });
  }
};

// ============================================================================
// Chat API
// ============================================================================

export const listWorkspaceConversations = async (workspaceId: string) => {
  try {
    const response = await fetch(
      `antidraw://_internal/workspaces/${workspaceId}/conversations`
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: Conversation[] = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to list conversations",
    });
  }
};

// TODO: workspaceId is always required even for existing conversations.
// Lookup workspaceId from conversation when conversationId is provided.
export async function* sendMessage(params: {
  message: string;
  workspaceId: string;
  conversationId?: string;
}): AsyncGenerator<ChatMessageResponse> {
  const { message, workspaceId, conversationId } = params;

  const stream = new ReadableStream<ChatMessageResponse>({
    start(controller) {
      fetchEventSource("antidraw://_internal/chat/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          workspaceId,
          conversationId,
        }),

        onmessage: (ev) => {
          controller.enqueue(JSON.parse(ev.data) as ChatMessageResponse);
        },
        onerror: (error) => controller.error(error),
        onclose: () => controller.close(),
      });
    },
  });

  yield* stream;
}

export const getConversationWithMessages = async (conversationId: string) => {
  try {
    const response = await fetch(
      `antidraw://_internal/chat/${conversationId}`
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: ConversationWithMessages = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to fetch conversation",
    });
  }
};

export const createConversation = async (workspaceId: string) => {
  try {
    const response = await fetch("antidraw://_internal/chat/conversation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspaceId }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: Conversation = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to create conversation",
    });
  }
};
