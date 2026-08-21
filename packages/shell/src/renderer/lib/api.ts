import type {
  ComponentListItem,
  ComponentSource,
  Conversation,
  ConversationWithMessages,
  CreateWorkspaceResponse,
  DevServerInfo,
  DevServerState,
  EffortLevel,
  ModelInfo,
  StreamEvent,
  Workspace,
} from "@/main/api";
import type { ImageAttachment } from "@/shared/utils/message";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { ok, err } from "neverthrow";

export type { StreamEvent, EffortLevel } from "@/main/api";

// The CLI's live model catalog (from main's session-lifetime cache).
export const getSupportedModels = async () => {
  try {
    const response = await fetch("antidraw://app/api/models");

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data = (await response.json()) as { models: ModelInfo[] };
    return ok(data.models);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to fetch model catalog",
    });
  }
};

// ============================================================================
// UI Preferences API
// ============================================================================

export const getPreference = async (key: string) => {
  try {
    const response = await fetch(`antidraw://app/api/preferences/${key}`);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { value: string | null } = await response.json();
    return ok(data.value);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to get preference",
    });
  }
};

export const setPreference = async (key: string, value: string) => {
  try {
    const response = await fetch(`antidraw://app/api/preferences/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    return ok(true);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to set preference",
    });
  }
};

// ============================================================================
// Claude CLI API
// ============================================================================

export const triggerClaudeLogin = async () => {
  try {
    const response = await fetch("antidraw://app/api/claude-cli/auth/login", {
      method: "POST",
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: (errorBody?.error?.code as string) ?? "FETCH_ERROR",
        message: (errorBody?.error?.message as string) ?? response.statusText,
      });
    }

    const data: { triggered: boolean } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to trigger Claude login",
    });
  }
};

// ============================================================================
// Workspace API
// ============================================================================

export async function* createWorkspace(
  name: string,
): AsyncGenerator<CreateWorkspaceResponse> {
  const abort = new AbortController();
  const stream = new ReadableStream<CreateWorkspaceResponse>({
    start(controller) {
      fetchEventSource("antidraw://app/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
        signal: abort.signal,
        openWhenHidden: true,

        onmessage: (ev) => {
          const event = JSON.parse(ev.data) as CreateWorkspaceResponse;
          controller.enqueue(event);
        },
        onerror: (error) => {
          controller.error(error);
          throw error;
        },
        onclose: () => {
          controller.close();
          throw new Error("Connection closed");
        },
      });
    },
    cancel() {
      abort.abort();
    },
  });

  yield* stream;
}

export const listWorkspaces = async () => {
  try {
    const response = await fetch("antidraw://app/api/workspaces");

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
    const response = await fetch(`antidraw://app/api/workspaces/${id}`);

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
    const response = await fetch(`antidraw://app/api/workspaces/${id}`, {
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
      `antidraw://app/api/workspaces/${workspaceId}/dev-server`,
      { method: "POST" },
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
      `antidraw://app/api/workspaces/${workspaceId}/dev-server`,
      { method: "DELETE" },
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
      `antidraw://app/api/workspaces/${workspaceId}/dev-server`,
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));

      // NOT_RUNNING is a valid status, not an error - map to running: false
      if (errorBody?.error?.code === "NOT_RUNNING") {
        return ok({
          workspaceId,
          pid: 0,
          port: 0,
          startedAt: 0,
          running: false,
        } satisfies DevServerInfo);
      }

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
// Component API
// ============================================================================

export const listComponents = async (workspaceId: string) => {
  try {
    const response = await fetch(
      `antidraw://app/api/workspaces/${workspaceId}/components`,
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: (errorBody?.error?.code as string) ?? "FETCH_ERROR",
        message: (errorBody?.error?.message as string) ?? response.statusText,
      });
    }

    const data: ComponentListItem[] = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to list components",
    });
  }
};

export const getComponentSource = async (
  workspaceId: string,
  componentName: string,
) => {
  try {
    const response = await fetch(
      `antidraw://app/api/workspaces/${workspaceId}/components/${encodeURIComponent(componentName)}/source`,
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: (errorBody?.error?.code as string) ?? "FETCH_ERROR",
        message: (errorBody?.error?.message as string) ?? response.statusText,
      });
    }

    const data: ComponentSource = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to get component source",
    });
  }
};

// ============================================================================
// Chat API
// ============================================================================

export const listWorkspaceConversations = async (workspaceId: string) => {
  try {
    const response = await fetch(
      `antidraw://app/api/workspaces/${workspaceId}/conversations`,
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

// Fire-and-forget message send - returns immediately with 202
export const sendMessage = async (params: {
  message: string;
  workspaceId: string;
  conversationId?: string;
  userMessageId: string; // Frontend generates this for dedup
  images?: ImageAttachment[];
  // Composer selection snapshot — options travel with the message (the only
  // way options are ever set). Absent = CLI defaults.
  model?: string;
  effort?: EffortLevel;
}) => {
  try {
    const response = await fetch("antidraw://app/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 409 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { conversationId: string } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to send message",
    });
  }
};

// Subscribe to conversation stream events via SSE.
//
// The AbortController is the single kill switch: aborting it cancels the
// underlying fetch (which makes the backend's request abort signal fire and
// detach its event listeners) and resolves fetchEventSource cleanly without
// triggering its default 1s auto-reconnect. Without this, a closed wrapper
// controller would still see the underlying HTTP stay open; the next event
// from the server would throw on enqueue, the library would auto-retry, and
// each retry would re-attach a listener on the backend — a geometric leak.
//
// `onerror` throws to make the no-retry intent explicit even though the
// signal abort would already prevent retries. Any non-clean close
// (transport error, backend crash, body ending before a terminal event) is
// surfaced as a synthetic `error` event so the consumer's existing error
// path runs — invalidating the conversation query and flipping status to
// `"error"` — instead of silently completing.
export const subscribeToConversation = async function* (
  conversationId: string,
): AsyncGenerator<StreamEvent> {
  const abort = new AbortController();
  let receivedTerminal = false;

  const stream = new ReadableStream<StreamEvent>({
    start(controller) {
      const finish = () => {
        controller.close();
        abort.abort();
      };

      const failClosed = (message: string) => {
        if (!receivedTerminal) {
          receivedTerminal = true;
          controller.enqueue({
            type: "error",
            error: message,
          } satisfies StreamEvent);
        }
        finish();
      };

      fetchEventSource(`antidraw://app/api/chat/${conversationId}/stream`, {
        signal: abort.signal,
        onopen: async (response) => {
          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const errorMessage =
              errorBody?.error?.message ?? response.statusText;
            failClosed(errorMessage);
          }
        },
        onmessage: (ev) => {
          const event = JSON.parse(ev.data) as StreamEvent;
          controller.enqueue(event);
          if (event.type === "complete" || event.type === "error") {
            receivedTerminal = true;
            finish();
          }
        },
        onerror: (error) => {
          const message =
            error instanceof Error ? error.message : "Stream connection failed";
          failClosed(message);
          throw error;
        },
        onclose: () => {
          if (!receivedTerminal) {
            failClosed("Stream ended unexpectedly");
          } else {
            finish();
          }
        },
      });
    },
    cancel() {
      abort.abort();
    },
  });

  yield* stream;
};

// Withdraw a queued (sent mid-turn, not yet accepted) message. The backend
// answers with the CLI's verdict: cancelled=true means it never runs and its
// row is gone; false means it already entered a turn (or never reached the
// CLI) and will run — keep the bubble, drop only the "Queued" mark.
export const cancelQueuedMessage = async (
  conversationId: string,
  userMessageId: string,
) => {
  try {
    const response = await fetch(
      `antidraw://app/api/chat/${conversationId}/message/${userMessageId}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { cancelled: boolean } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to cancel queued message",
    });
  }
};

// Cancel an active stream
export const cancelConversationStream = async (conversationId: string) => {
  try {
    const response = await fetch(
      `antidraw://app/api/chat/${conversationId}/stream`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { cancelled: boolean } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to cancel stream",
    });
  }
};

export const getConversationWithMessages = async (conversationId: string) => {
  try {
    const response = await fetch(`antidraw://app/api/chat/${conversationId}`);

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
    const response = await fetch("antidraw://app/api/chat/conversation", {
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

export type GenerateTitleResponse = { title: string; summary: string };

export const generateConversationTitle = async (
  conversationId: string,
  firstMessage: string,
) => {
  try {
    const response = await fetch(
      `antidraw://app/api/chat/${conversationId}/generate-title`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstMessage }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: GenerateTitleResponse = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to generate title",
    });
  }
};

// ============================================================================
// Frame Layout API
// ============================================================================

export type FrameLayoutData = {
  workspaceId: string;
  componentName: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const getFrameLayouts = async (workspaceId: string) => {
  try {
    const response = await fetch(
      `antidraw://app/api/workspaces/${workspaceId}/frame-layouts`,
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: FrameLayoutData[] = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to get frame layouts",
    });
  }
};

export const saveFrameLayouts = async (
  workspaceId: string,
  layouts: {
    componentName: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[],
) => {
  try {
    const response = await fetch(
      `antidraw://app/api/workspaces/${workspaceId}/frame-layouts`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layouts }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    return ok(true);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to save frame layouts",
    });
  }
};
