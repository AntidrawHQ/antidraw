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

// The link died, not the conversation. Thrown out of subscribeToConversation
// so the caller can tell a transport failure — which resuming fixes — from a
// backend `error` event, which is the turn itself failing and is terminal.
// `retriable` is false only when reconnecting cannot help: a 4xx on open means
// the conversation is gone, and no amount of retrying brings it back.
export class StreamDisconnectedError extends Error {
  readonly retriable: boolean;

  constructor(message: string, retriable: boolean) {
    super(message);
    this.name = "StreamDisconnectedError";
    this.retriable = retriable;
  }
}

// Subscribe to conversation stream events via SSE.
//
// `afterSeq`, when given, asks the backend to replay the transcript past that
// point before live events start. That is what makes a reconnect lossless, and
// it also closes the gap between the initial GET reading the DB and this
// subscription attaching its listener.
//
// `release` ends the subscription from the outside — the open conversation
// closing. It completes the iteration rather than throwing: the caller asked
// for this, so there is nothing to report.
//
// The AbortController is the single kill switch: aborting it cancels the
// underlying fetch (which makes the backend's request abort signal fire and
// detach its event listeners) and resolves fetchEventSource cleanly without
// triggering its default 1s auto-reconnect. Without this, a closed wrapper
// controller would still see the underlying HTTP stay open; the next event
// from the server would throw on enqueue, the library would auto-retry, and
// each retry would re-attach a listener on the backend — a geometric leak.
// That is a reason to keep retries out of THIS function, not out of the
// caller: subscribeToStream reconnects by calling it again, and this abort
// fires first, so the backend detaches before the replacement attaches.
//
// A non-clean close (transport error, backend crash, body ending before a
// terminal event) errors the stream with StreamDisconnectedError rather than
// synthesizing an `error` event. Enqueued events still drain first — the
// ReadableStream contract — so nothing already received is lost, and the
// caller decides between resuming and giving up.
export const subscribeToConversation = async function* (
  conversationId: string,
  afterSeq?: number,
  release?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const abort = new AbortController();
  let receivedTerminal = false;

  const url = new URL(`antidraw://app/api/chat/${conversationId}/stream`);
  if (afterSeq !== undefined) url.searchParams.set("afterSeq", String(afterSeq));

  const stream = new ReadableStream<StreamEvent>({
    start(controller) {
      // A controller can only be ended once, and both endings are reachable
      // from the same failure: onopen rejecting does not stop fetchEventSource
      // from going on to close the body. Whichever gets there first wins.
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        controller.close();
        abort.abort();
      };

      const failClosed = (message: string, retriable: boolean) => {
        if (settled) return;
        settled = true;
        receivedTerminal = true;
        controller.error(new StreamDisconnectedError(message, retriable));
        abort.abort();
      };

      // Ending the iteration is the caller's only reliable exit. Calling
      // return() on the generator would not do it: while it is suspended
      // awaiting the next chunk, the return request queues behind that read,
      // and a stream with nothing to say never resolves it. Closing the
      // controller here ends the for-await AND aborts the fetch, which is
      // what makes the backend drop its listeners.
      if (release) {
        if (release.aborted) return finish();
        release.addEventListener("abort", finish, { once: true });
      }

      fetchEventSource(url.toString(), {
        signal: abort.signal,
        onopen: async (response) => {
          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const errorMessage =
              errorBody?.error?.message ?? response.statusText;
            // 4xx is a verdict about the conversation; 5xx is the backend
            // having a bad moment, which a retry can outlast.
            failClosed(errorMessage, response.status >= 500);
          }
        },
        onmessage: (ev) => {
          const event = JSON.parse(ev.data) as StreamEvent;
          controller.enqueue(event);
          // Only a dead owning loop ends the subscription. `state: "idle"`
          // does NOT: the CLI goes idle between turns, and it can report
          // idle while a message we handed it is still un-acked — closing
          // there would miss that message's ack and every event after it.
          if (event.type === "error") {
            receivedTerminal = true;
            finish();
          }
        },
        onerror: (error) => {
          const message =
            error instanceof Error ? error.message : "Stream connection failed";
          failClosed(message, true);
          throw error;
        },
        onclose: () => {
          if (!receivedTerminal) {
            failClosed("Stream ended unexpectedly", true);
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
