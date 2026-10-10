import type {
  Account,
  Comment,
  CommentChat,
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
import type { CommentContext } from "@/shared/utils/canvas-comments";
import type { AskUserQuestionAnswers } from "@/shared/utils/ask-user-question";
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
  // Canvas comments the message carries: marked sent into the chat by the
  // backend before the turn starts, or the send is refused.
  commentIds?: number[];
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
// fires first — cancelling the response body, which the route answers with
// stream.onAbort — so the backend detaches before the replacement attaches.
//
// A non-clean close (transport error, backend crash, body ending before a
// terminal event) errors the stream with StreamDisconnectedError rather than
// synthesizing an `error` event, and the caller decides between resuming and
// giving up.
//
// Anything still queued at that moment is DISCARDED: controller.error() resets
// the queue, and only controller.close() drains it. The queue is non-empty
// whenever a chunk carried more frames than the consumer had read — one chunk
// fires onmessage once per frame, synchronously — so this is ordinary during a
// busy turn, not a corner case.
//
// Nothing is lost by it, but this function is not what makes that true: the
// caller reconnects from a cursor it derives from its own cache, so rows that
// never arrived are simply asked for again. That replay is load-bearing. Do
// not remove it on the belief that the transport delivers everything it
// accepted — it does not.
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

      // `once: true` only detaches when the release actually fires. Every
      // other ending leaves the listener on a signal that outlives this
      // attempt — subscribeToStream passes the same one to every reconnect —
      // so without this each dead attempt would pin its controller for the
      // life of the conversation.
      const detachRelease = () => release?.removeEventListener("abort", finish);

      const finish = () => {
        if (settled) return;
        settled = true;
        detachRelease();
        controller.close();
        abort.abort();
      };

      const failClosed = (message: string, retriable: boolean) => {
        if (settled) return;
        settled = true;
        receivedTerminal = true;
        detachRelease();
        controller.error(new StreamDisconnectedError(message, retriable));
        abort.abort();
      };

      // Ending the iteration is the caller's only reliable exit. Calling
      // return() on the generator would not do it: while it is suspended
      // awaiting the next chunk, the return request queues behind that read,
      // and a stream with nothing to say never resolves it. Closing the
      // controller here ends the for-await AND aborts the fetch. The abort
      // cancels the response body — not the backend's request signal, which
      // under protocol.handle can never fire — and the route's stream.onAbort
      // is what drops its listeners.
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

// Answers a question the CLI is blocked on. 404 when it is no longer waiting
// (answered elsewhere, cancelled by Stop, or the turn ended); 400 when the
// answers do not fit the question.
export const answerQuestion = async (
  conversationId: string,
  toolUseId: string,
  answers: AskUserQuestionAnswers,
) => {
  try {
    const response = await fetch(
      `antidraw://app/api/chat/${conversationId}/question/${encodeURIComponent(toolUseId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 400 | 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { answered: true } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to answer the question",
    });
  }
};

export const declineQuestion = async (
  conversationId: string,
  toolUseId: string,
) => {
  try {
    const response = await fetch(
      `antidraw://app/api/chat/${conversationId}/question/${encodeURIComponent(toolUseId)}`,
      { method: "DELETE" },
    );

    // 404 carries a body too: { declined: false } — nothing was waiting.
    if (!response.ok && response.status !== 404) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { declined: boolean } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to decline the question",
    });
  }
};

// Prompts the CLI never received. The backend computes it from the
// delivered_at column and its live pending set; see useFailedMessageIds for
// when it is asked.
export const getFailedMessageIds = async (conversationId: string) => {
  try {
    const response = await fetch(
      `antidraw://app/api/chat/${conversationId}/undelivered`,
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 404 | 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    const data: { failedUserMessageIds: string[] } = await response.json();
    return ok(data.failedUserMessageIds);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to read undelivered prompts",
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

// ============================================================================
// Comments API
// ============================================================================

export type CommentList = { comments: Comment[]; chats: CommentChat[] };

const commentsUrl = (workspaceId: string, path = "") =>
  `antidraw://app/api/workspaces/${workspaceId}/comments${path}`;

// One request to the comments routes, as a Result like the rest.
const commentsRequest = async <T>(
  url: string,
  failure: string,
  init?: { method: string; body?: unknown },
) => {
  try {
    const response = await fetch(url, {
      method: init?.method,
      ...(init?.body !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(init.body),
          }
        : {}),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: errorBody?.error?.code ?? "FETCH_ERROR",
        message: errorBody?.error?.message ?? response.statusText,
      });
    }

    return ok((await response.json()) as T);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: failure,
    });
  }
};

export const listComments = (workspaceId: string) =>
  commentsRequest<CommentList>(commentsUrl(workspaceId), "Failed to list comments");

export const addComment = (
  workspaceId: string,
  comment: Pick<Comment, "componentName" | "x" | "y" | "text" | "element">,
) =>
  commentsRequest<Comment>(commentsUrl(workspaceId), "Failed to add comment", {
    method: "POST",
    body: comment,
  });

export const editComment = (workspaceId: string, id: number, text: string) =>
  commentsRequest<Comment>(commentsUrl(workspaceId, `/${id}`), "Failed to edit comment", {
    method: "PATCH",
    body: { text },
  });

export const removeComment = (workspaceId: string, id: number) =>
  commentsRequest<{ ok: true }>(commentsUrl(workspaceId, `/${id}`), "Failed to remove comment", {
    method: "DELETE",
  });

export const clearCompletedComments = (workspaceId: string) =>
  commentsRequest<{ ok: true }>(
    commentsUrl(workspaceId, "/clear-completed"),
    "Failed to clear completed comments",
    { method: "POST" },
  );

// The message that sends the drafts in `context` to a chat
// (`conversationId`, if one's open), and which of them it carries. Changes
// nothing: it goes out as a chat message (sendMessage with commentIds).
export const commentsPrompt = (
  workspaceId: string,
  params: { context: CommentContext[]; conversationId?: string },
) =>
  commentsRequest<{ ids: number[]; prompt: string }>(
    commentsUrl(workspaceId, "/prompt"),
    "Failed to describe comments",
    { method: "POST", body: params },
  );

// Calls `onChange` whenever the workspace's comments may have changed, and
// once on every (re)connect. Reconnects on its own, backing off, until the
// returned stop is called. Nothing rides on the events, so a drop loses
// nothing: the change on reconnect makes up for whatever went by.
export const watchComments = (workspaceId: string, onChange: () => void) => {
  let stopped = false;
  let attempt: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;

  const connect = () => {
    const abort = new AbortController();
    attempt = abort;
    let ended = false;
    // One retry per attempt, from whichever ending gets there first. The
    // abort cancels the body, which is what detaches the route's listeners
    // (see /chat/:id/stream), before the next attempt attaches its own.
    const retry = () => {
      if (ended) return;
      ended = true;
      abort.abort();
      if (stopped) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    };
    fetchEventSource(commentsUrl(workspaceId, "/events"), {
      signal: abort.signal,
      openWhenHidden: true,
      onopen: async (response) => {
        if (!response.ok) throw new Error(response.statusText);
      },
      onmessage: () => {
        delay = 1000;
        onChange();
      },
      // Thrown, so the library doesn't retry on its own: retry() does.
      onerror: (error) => {
        retry();
        throw error;
      },
      onclose: retry,
    }).catch(() => {});
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    attempt?.abort();
  };
};

// ============================================================================
// Cloud account API
// ============================================================================

// The account routes answer only the app's own pages, which prove it with
// main's per-launch key (main/lib/app-key.ts).
const appKeyHeader = () => ({ "x-antidraw-app-key": window.electronAPI?.appKey ?? "" });

export const getAccount = async () => {
  try {
    const response = await fetch("antidraw://app/api/account", { headers: appKeyHeader() });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: (errorBody?.error?.code as string) ?? "FETCH_ERROR",
        message: (errorBody?.error?.message as string) ?? response.statusText,
      });
    }

    const data: { account: Account | null } = await response.json();
    return ok(data.account);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to get account",
    });
  }
};

// Resolves once the user finishes in the browser, or with CANCELLED /
// TIMED_OUT / ACCESS_DENIED if they don't.
export const signIn = async () => {
  try {
    const response = await fetch("antidraw://app/api/account/sign-in", {
      headers: appKeyHeader(),
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

    const data: { account: Account } = await response.json();
    return ok(data.account);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to sign in",
    });
  }
};

export const cancelSignIn = async () => {
  try {
    await fetch("antidraw://app/api/account/sign-in/cancel", {
      headers: appKeyHeader(),
      method: "POST",
    });
    return ok(true);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to cancel sign-in",
    });
  }
};

export const signOut = async () => {
  try {
    await fetch("antidraw://app/api/account/sign-out", {
      method: "POST",
      headers: appKeyHeader(),
    });
    return ok(true);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to sign out",
    });
  }
};

// Builds the workspace and publishes it; resolves with the share page's URL.
// Takes as long as the build and upload do.
export const publishWorkspace = async (workspaceId: string) => {
  try {
    const response = await fetch(
      `antidraw://app/api/workspaces/${workspaceId}/publish`,
      { method: "POST" },
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return err({
        status: response.status as 500,
        code: (errorBody?.error?.code as string) ?? "FETCH_ERROR",
        message: (errorBody?.error?.message as string) ?? response.statusText,
      });
    }

    const data: { url: string } = await response.json();
    return ok(data);
  } catch (_e) {
    return err({
      status: 500 as const,
      code: "NETWORK_ERROR",
      message: "Failed to publish",
    });
  }
};
