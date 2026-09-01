import { describe, test, expect, afterEach, vi } from "vitest";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { buildPrompt } from "@/main/api/claude-code-ops";
import { conversationEvents, subscribe } from "../events";
import {
  addPending,
  attachQuery,
  cancelQueued,
  openHandle,
  clearPending,
  getPending,
  getHandle,
  getStreamStatus,
  interrupt,
  markError,
  releaseHandle,
  resolvePending,
  setCliState,
} from "../store";

// The real prompt stream — nothing about it needs a CLI to exist.
const promptStream = () => buildPrompt("hello", { uuid: crypto.randomUUID() });

const fakeQuery = () => ({}) as Query;

// A query that records the control requests the store sends it. Only the two
// the store ever calls are stubbed.
const controllableQuery = (cancelVerdict = true) => {
  const query = {
    interrupt: vi.fn(async () => {}),
    cancelAsyncMessage: vi.fn(async () => cancelVerdict),
  };
  return query as unknown as Query & typeof query;
};

let counter = 0;
const freshId = () => `conversation-${counter++}`;

// Everything about a handle that is worth snapshotting. The id is left out
// on purpose: it comes from a counter, so including it would churn every
// snapshot below whenever a test is added above.
const view = (conversationId: string) => {
  const handle = getHandle(conversationId);
  return {
    status: getStreamStatus(conversationId),
    handle: handle
      ? {
          cliState: handle.cliState,
          hasQuery: handle.query !== null,
          pending: [...handle.pendingUserMessageIds],
          partial: handle.partial,
        }
      : null,
  };
};

const detach: Array<() => void> = [];
afterEach(() => {
  detach.splice(0).forEach((off) => off());
});

const capture = (conversationId: string) => {
  const seen: unknown[] = [];
  detach.push(
    subscribe(conversationId, (event) => {
      if (event.type === "state") seen.push({ state: event.state });
      if (event.type === "queue") seen.push({ queue: event.userMessageIds });
    }),
  );
  return seen;
};

describe("the error event", () => {
  // Node throws ERR_UNHANDLED_ERROR when "error" is emitted with no listener,
  // which would swallow the real cause of a turn that failed before anyone
  // subscribed. The store keeps a permanent listener so this stays ordinary.
  test("emitting one with nobody subscribed does not throw", () => {
    expect(() =>
      conversationEvents.emit("error", freshId(), { error: "boom" }),
    ).not.toThrow();
  });
});

describe("openHandle", () => {
  test("the first caller cold-starts and the second is a follow-up", () => {
    const id = freshId();
    expect(openHandle(id, promptStream())).toBe("cold-start");
    expect(openHandle(id, promptStream())).toBe("follow-up");
  });

  test("the loser does not replace the winner's prompt stream", () => {
    const id = freshId();
    const winner = promptStream();
    openHandle(id, winner);
    openHandle(id, promptStream());
    // Identity, not shape — a snapshot cannot express "the same object".
    expect(getHandle(id)?.promptStream).toBe(winner);
  });

  test("a fresh handle starts spawning, queryless and empty", () => {
    const id = freshId();
    openHandle(id, promptStream());
    expect(view(id)).toMatchInlineSnapshot(`
      {
        "handle": {
          "cliState": "spawning",
          "hasQuery": false,
          "partial": null,
          "pending": [],
        },
        "status": "streaming",
      }
    `);
  });

  test("opening again after release starts a new handle", () => {
    const id = freshId();
    openHandle(id, promptStream());
    releaseHandle(id);
    expect(openHandle(id, promptStream())).toBe("cold-start");
  });
});

describe("attachQuery", () => {
  test("fills the query left null when the handle opened", () => {
    const id = freshId();
    openHandle(id, promptStream());
    attachQuery(id, fakeQuery());
    expect(view(id)).toMatchInlineSnapshot(`
      {
        "handle": {
          "cliState": "spawning",
          "hasQuery": true,
          "partial": null,
          "pending": [],
        },
        "status": "streaming",
      }
    `);
  });

  test("is a no-op for a conversation with no handle", () => {
    const id = freshId();
    expect(() => attachQuery(id, fakeQuery())).not.toThrow();
    expect(view(id)).toMatchInlineSnapshot(`
      {
        "handle": null,
        "status": "idle",
      }
    `);
  });
});

describe("getStreamStatus", () => {
  test("a conversation that never ran is idle", () => {
    expect(view(freshId())).toMatchInlineSnapshot(`
      {
        "handle": null,
        "status": "idle",
      }
    `);
  });

  test("every cliState maps to a stream status", () => {
    const states = ["spawning", "running", "requires_action", "idle"] as const;
    const mapping = Object.fromEntries(
      states.map((cliState) => {
        const id = freshId();
        openHandle(id, promptStream());
        setCliState(id, cliState);
        return [cliState, getStreamStatus(id)];
      }),
    );
    expect(mapping).toEqual({
      spawning: "streaming",
      running: "streaming",
      requires_action: "streaming",
      idle: "idle",
    });
  });

  test("an un-acked send does NOT hold the status — the CLI's idle passes through", () => {
    const id = freshId();
    openHandle(id, promptStream());
    setCliState(id, "running");
    addPending(id, "queued-send");
    setCliState(id, "idle");

    // Deliberate, and the test exists so nobody "fixes" it: the CLI reports
    // idle for a push it has not parsed yet, and this reads idle for a beat
    // until its `running` corrects it. Letting pending outrank cliState
    // would reintroduce base's hold WITHOUT the 30s watchdog that bounded
    // it — a push the CLI never acks would pin "streaming", and the
    // spinner, forever. cliState speaks for the CLI; the queue event
    // speaks for the queue.
    expect(getStreamStatus(id)).toBe("idle");
    expect(getPending(id)).toEqual(["queued-send"]);

    resolvePending(id, "queued-send");
    expect(getStreamStatus(id)).toBe("idle");
  });

  test("a died-and-released conversation reads as error, not idle", () => {
    const id = freshId();
    openHandle(id, promptStream());
    markError(id);
    releaseHandle(id);
    expect(view(id)).toMatchInlineSnapshot(`
      {
        "handle": null,
        "status": "error",
      }
    `);
  });

  test("a live handle outranks a stale error flag", () => {
    const id = freshId();
    markError(id);
    openHandle(id, promptStream());
    setCliState(id, "running");
    expect(view(id)).toMatchInlineSnapshot(`
      {
        "handle": {
          "cliState": "running",
          "hasQuery": false,
          "partial": null,
          "pending": [],
        },
        "status": "streaming",
      }
    `);
  });

  test("opening a handle clears the error, so the next clean release reads idle", () => {
    const id = freshId();
    markError(id);
    openHandle(id, promptStream());
    setCliState(id, "idle");
    releaseHandle(id);
    expect(view(id)).toMatchInlineSnapshot(`
      {
        "handle": null,
        "status": "idle",
      }
    `);
  });
});

describe("setCliState", () => {
  test("emits each transition the CLI reports", () => {
    const id = freshId();
    openHandle(id, promptStream());
    const seen = capture(id);
    setCliState(id, "running");
    setCliState(id, "requires_action");
    setCliState(id, "running");
    setCliState(id, "idle");
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "state": "running",
        },
        {
          "state": "requires_action",
        },
        {
          "state": "running",
        },
        {
          "state": "idle",
        },
      ]
    `);
  });

  test("a repeated state is not a transition and emits nothing", () => {
    const id = freshId();
    openHandle(id, promptStream());
    setCliState(id, "running");
    const seen = capture(id);
    setCliState(id, "running");
    expect(seen).toMatchInlineSnapshot(`[]`);
  });

  test("is a no-op for a conversation with no handle", () => {
    const id = freshId();
    const seen = capture(id);
    setCliState(id, "running");
    expect(seen).toMatchInlineSnapshot(`[]`);
  });
});

describe("the pending queue", () => {
  test("every add broadcasts the whole set, not a delta", () => {
    const id = freshId();
    openHandle(id, promptStream());
    const seen = capture(id);
    addPending(id, "msg-a");
    addPending(id, "msg-b");
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "queue": [
            "msg-a",
          ],
        },
        {
          "queue": [
            "msg-a",
            "msg-b",
          ],
        },
      ]
    `);
  });

  test("re-adding an id already pending emits nothing", () => {
    const id = freshId();
    openHandle(id, promptStream());
    addPending(id, "msg-a");
    const seen = capture(id);
    addPending(id, "msg-a");
    expect(seen).toMatchInlineSnapshot(`[]`);
  });

  test("resolving shrinks the broadcast set", () => {
    const id = freshId();
    openHandle(id, promptStream());
    addPending(id, "msg-a");
    addPending(id, "msg-b");
    const seen = capture(id);
    resolvePending(id, "msg-a");
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "queue": [
            "msg-b",
          ],
        },
      ]
    `);
  });

  test("resolving an id we never pushed is silent", () => {
    const id = freshId();
    openHandle(id, promptStream());
    addPending(id, "msg-a");
    const seen = capture(id);
    expect(resolvePending(id, "cli-internal-reminder")).toBe(false);
    expect(seen).toMatchInlineSnapshot(`[]`);
  });

  test("a folded burst acks one id at a time, in push order", () => {
    const id = freshId();
    openHandle(id, promptStream());
    addPending(id, "msg-1");
    addPending(id, "msg-2");
    addPending(id, "msg-3");
    addPending(id, "msg-4");
    const seen = capture(id);
    resolvePending(id, "msg-2");
    resolvePending(id, "msg-3");
    resolvePending(id, "msg-4");
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "queue": [
            "msg-1",
            "msg-3",
            "msg-4",
          ],
        },
        {
          "queue": [
            "msg-1",
            "msg-4",
          ],
        },
        {
          "queue": [
            "msg-1",
          ],
        },
      ]
    `);
  });

  test("teardown broadcasts an empty set so no mark is left behind", () => {
    const id = freshId();
    openHandle(id, promptStream());
    addPending(id, "msg-a");
    const seen = capture(id);
    clearPending(id);
    releaseHandle(id);
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "queue": [],
        },
      ]
    `);
  });

  test("clearing an already-empty set emits nothing", () => {
    const id = freshId();
    openHandle(id, promptStream());
    const seen = capture(id);
    clearPending(id);
    expect(seen).toMatchInlineSnapshot(`[]`);
  });

  test("getPending reads the set, and is empty with no runtime", () => {
    const id = freshId();
    openHandle(id, promptStream());
    addPending(id, "msg-a");
    addPending(id, "msg-b");
    const live = getPending(id);
    releaseHandle(id);
    expect({ live, released: getPending(id) }).toMatchInlineSnapshot(`
      {
        "live": [
          "msg-a",
          "msg-b",
        ],
        "released": [],
      }
    `);
  });
});

describe("interrupt", () => {
  test("sends the control request and keeps the handle open", async () => {
    const id = freshId();
    openHandle(id, promptStream());
    const query = controllableQuery();
    attachQuery(id, query);

    expect(await interrupt(id)).toBe(true);
    expect(query.interrupt).toHaveBeenCalledTimes(1);
    // The regression that cost a leaked CLI per Stop click: the process, the
    // query and the pipe all survive an interrupt, so the handle must stay open too.
    expect(getHandle(id)).toBeDefined();
  });

  test("does nothing while the CLI is still spawning", async () => {
    const id = freshId();
    openHandle(id, promptStream());
    expect(await interrupt(id)).toBe(false);
  });

  test("does nothing for a conversation with no handle", async () => {
    expect(await interrupt(freshId())).toBe(false);
  });

  test("leaves the pending queue untouched", async () => {
    const id = freshId();
    openHandle(id, promptStream());
    attachQuery(id, controllableQuery());
    addPending(id, "msg-a");
    const seen = capture(id);
    await interrupt(id);
    expect(seen).toMatchInlineSnapshot(`[]`);
    expect(getPending(id)).toEqual(["msg-a"]);
  });
});

describe("cancelQueued", () => {
  test("a withdrawn message leaves the queue and is broadcast", async () => {
    const id = freshId();
    openHandle(id, promptStream());
    const query = controllableQuery(true);
    attachQuery(id, query);
    addPending(id, "msg-a");
    addPending(id, "msg-b");
    const seen = capture(id);

    expect(await cancelQueued(id, "msg-a")).toBe(true);
    expect(query.cancelAsyncMessage).toHaveBeenCalledWith("msg-a");
    expect(seen).toMatchInlineSnapshot(`
      [
        {
          "queue": [
            "msg-b",
          ],
        },
      ]
    `);
  });

  test("the CLI's refusal wins: an already-folded message stays pending", async () => {
    const id = freshId();
    openHandle(id, promptStream());
    attachQuery(id, controllableQuery(false));
    addPending(id, "msg-a");
    const seen = capture(id);

    expect(await cancelQueued(id, "msg-a")).toBe(false);
    expect(seen).toMatchInlineSnapshot(`[]`);
    expect(getPending(id)).toEqual(["msg-a"]);
  });

  test("is a no-op while the CLI is still spawning", async () => {
    const id = freshId();
    openHandle(id, promptStream());
    addPending(id, "msg-a");
    expect(await cancelQueued(id, "msg-a")).toBe(false);
    expect(getPending(id)).toEqual(["msg-a"]);
  });

  test("is a no-op for a conversation with no handle", async () => {
    expect(await cancelQueued(freshId(), "msg-a")).toBe(false);
  });
});
