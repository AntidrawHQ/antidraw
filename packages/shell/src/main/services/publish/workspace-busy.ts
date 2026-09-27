import { err, ok, type Result } from "neverthrow";
import { listConversations } from "@/main/api/services/chat.service";
import {
  conversationEvents,
  getCliState,
  getPending,
  type CliSessionState,
} from "@/main/lib/conversation-store";

// Publishing snapshots the workspace's files, so it is refused while Claude
// may be writing them: an agent turn running, or a prompt queued for one.
// A point check alone would miss a turn that starts and ends between two
// checks, so the watch also listens for turn and queue events from the moment
// it is taken. This only reads the conversation store; it never changes it.

type DbError = { status: 500; code: "DB_ERROR"; message: string };

export type ActivityWatch = {
  // Busy right now: some conversation streaming, its CLI not idle, or a
  // prompt pending. Also waits for any membership lookup the watch started,
  // so a dirty() right after it is complete.
  busyNow(): Promise<Result<boolean, DbError>>;
  // A turn started or a prompt was queued in this workspace since the watch
  // began (even if it has finished since).
  dirty(): boolean;
  stop(): void;
};

export const watchWorkspaceActivity = (workspaceId: string): ActivityWatch => {
  let dirty = false;
  // Conversations known to be in / not in this workspace. A conversation
  // never changes workspace, so both sets only grow.
  const members = new Set<string>();
  const others = new Set<string>();
  const lookups = new Set<Promise<void>>();

  const load = async () => {
    const result = await listConversations(workspaceId);
    if (result.isOk()) for (const c of result.value) members.add(c.id);
    return result;
  };

  const track = (lookup: Promise<void>) => {
    lookups.add(lookup);
    void lookup.finally(() => lookups.delete(lookup));
  };

  // An event for a conversation not seen yet: it may be one created in this
  // workspace after the watch began, so re-read the list. A failed read counts
  // as activity; refusing a publish is the safe side.
  const resolve = (conversationId: string) =>
    track(
      load().then((result) => {
        if (result.isErr() || members.has(conversationId)) dirty = true;
        else others.add(conversationId);
      }),
    );

  const seen = (conversationId: string) => {
    if (members.has(conversationId)) dirty = true;
    else if (!others.has(conversationId)) resolve(conversationId);
  };

  const onState = (conversationId: string, { state }: { state: CliSessionState }) => {
    if (state !== "idle") seen(conversationId);
  };
  const onQueue = (conversationId: string, { userMessageIds }: { userMessageIds: string[] }) => {
    if (userMessageIds.length > 0) seen(conversationId);
  };

  conversationEvents.on("state", onState);
  conversationEvents.on("queue", onQueue);

  // Membership for events that arrive before the first busyNow(). A failure
  // here surfaces from busyNow(), which reads the list again.
  track(load().then(() => undefined));

  return {
    busyNow: async () => {
      while (lookups.size > 0) await Promise.all([...lookups]);
      const conversations = await load();
      if (conversations.isErr()) {
        return err({
          status: 500,
          code: "DB_ERROR",
          message: conversations.error.message,
        });
      }
      return ok(
        conversations.value.some(
          (c) =>
            c.streamStatus === "streaming" ||
            getCliState(c.id) !== "idle" ||
            // A push the CLI has not parsed yet still reports idle, but it is
            // already in the pending set.
            getPending(c.id).length > 0,
        ),
      );
    },
    dirty: () => dirty,
    stop: () => {
      conversationEvents.off("state", onState);
      conversationEvents.off("queue", onQueue);
    },
  };
};
