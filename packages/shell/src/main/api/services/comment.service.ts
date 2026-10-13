import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  TransactionRollbackError,
} from "drizzle-orm";
import { ok, err } from "neverthrow";
import { db } from "@/main/db";
import { comments, type Comment } from "@/main/api/models/comment.model";
import { getCliState } from "@/main/lib/conversation-store";
import { commentEvents } from "@/main/lib/comment-events";
import {
  describeComments,
  type CommentContext,
  type EarlierSet,
  type NewCommentInput,
} from "@/shared/utils/canvas-comments";

// A set's chat, where it's got to: opening while the CLI spawns, running
// while it works or waits on the user, ended once it's idle. Read from
// memory, like a conversation's stream status.
export type ChatPhase = "opening" | "running" | "ended";

export type CommentChat = { conversationId: string; n: number; phase: ChatPhase };

// How many earlier sets a new chat is handed.
const HISTORY_SETS = 5;

const phaseOf = (conversationId: string): ChatPhase => {
  const state = getCliState(conversationId);
  return state === "spawning" ? "opening" : state === "idle" ? "ended" : "running";
};

const dbError = (message: string) =>
  err({ status: 500 as const, code: "DB_ERROR", message });

const notFound = (message: string) =>
  err({ status: 404 as const, code: "NOT_FOUND", message });

// Every set the workspace ever sent, cleared ones too, numbered in the order
// they went out: Chat 1, Chat 2…
const numberedSets = (rows: Comment[]) => {
  const first = new Map<string, number>();
  for (const c of rows)
    if (c.conversationId && c.sentAt) {
      const t = c.sentAt.getTime();
      if (!first.has(c.conversationId) || t < first.get(c.conversationId)!)
        first.set(c.conversationId, t);
    }
  return [...first]
    .sort((a, b) => a[1] - b[1])
    .map(([conversationId], i) => ({ conversationId, n: i + 1 }));
};

const workspaceComments = (workspaceId: string) =>
  db
    .select()
    .from(comments)
    .where(eq(comments.workspaceId, workspaceId))
    .orderBy(asc(comments.id));

// The list: what isn't cleared, and the chats of the sets it holds.
export const listComments = async (workspaceId: string) => {
  try {
    const rows = await workspaceComments(workspaceId);
    const shown = rows.filter((c) => !c.clearedAt);
    const held = new Set(shown.map((c) => c.conversationId));
    const chats: CommentChat[] = numberedSets(rows)
      .filter((s) => held.has(s.conversationId))
      .map((s) => ({ ...s, phase: phaseOf(s.conversationId) }));
    return ok({ comments: shown, chats });
  } catch (_e) {
    return dbError("Failed to list comments");
  }
};

export const addComment = async (
  workspaceId: string,
  input: Pick<Comment, "componentName" | "x" | "y" | "text" | "element">,
) => {
  try {
    const [row] = await db
      .insert(comments)
      .values({ workspaceId, ...input, text: input.text.trim() })
      .returning();
    commentEvents.emit("changed", workspaceId);
    return ok(row!);
  } catch (_e) {
    return dbError("Failed to add comment");
  }
};

// Only a comment that hasn't gone out can be edited.
export const editComment = async (workspaceId: string, id: number, text: string) => {
  try {
    const [row] = await db
      .update(comments)
      .set({ text: text.trim() })
      .where(
        and(
          eq(comments.id, id),
          eq(comments.workspaceId, workspaceId),
          eq(comments.state, "draft"),
        ),
      )
      .returning();
    if (!row) return notFound("No such comment to edit");
    commentEvents.emit("changed", workspaceId);
    return ok(row);
  } catch (_e) {
    return dbError("Failed to edit comment");
  }
};

// A draft goes for good; a sent one only leaves the list, and stays history.
export const removeComment = async (workspaceId: string, id: number) => {
  try {
    const where = and(eq(comments.id, id), eq(comments.workspaceId, workspaceId));
    const [deleted] = await db
      .delete(comments)
      .where(and(where, eq(comments.state, "draft")))
      .returning();
    const [cleared] = deleted
      ? [deleted]
      : await db
          .update(comments)
          .set({ clearedAt: new Date() })
          .where(and(where, isNull(comments.clearedAt)))
          .returning();
    if (!cleared) return notFound("No such comment");
    commentEvents.emit("changed", workspaceId);
    return ok(true);
  } catch (_e) {
    return dbError("Failed to remove comment");
  }
};

// Completed comments off the list, from sets whose chats have ended.
export const clearCompleted = async (workspaceId: string) => {
  try {
    const done = await db
      .select({ id: comments.id, conversationId: comments.conversationId })
      .from(comments)
      .where(
        and(
          eq(comments.workspaceId, workspaceId),
          eq(comments.state, "done"),
          isNull(comments.clearedAt),
          isNotNull(comments.conversationId),
        ),
      );
    const ids = done
      .filter((c) => phaseOf(c.conversationId!) === "ended")
      .map((c) => c.id);
    if (ids.length) {
      await db
        .update(comments)
        .set({ clearedAt: new Date() })
        .where(inArray(comments.id, ids));
      commentEvents.emit("changed", workspaceId);
    }
    return ok(true);
  } catch (_e) {
    return dbError("Failed to clear completed comments");
  }
};

// The message that sends drafts to a chat: them, and the other chats'
// earlier sets (`into`, the chat it's for, has its own). Reads only: the send
// itself is POST /chat/message, which marks them (markCommentsSent). The
// canvas describes the elements (`context`): only the frames can.
export const describeDrafts = async (
  workspaceId: string,
  context: CommentContext[],
  into?: string,
) => {
  try {
    const rows = await workspaceComments(workspaceId);
    const byId = new Map(context.map((c) => [c.id, c]));
    const drafts = rows.filter((c) => c.state === "draft" && byId.has(c.id));
    if (!drafts.length) return notFound("No comments to send");

    const earlier: EarlierSet[] = numberedSets(rows)
      .filter((s) => s.conversationId !== into)
      .slice(-HISTORY_SETS)
      .map(({ conversationId: id, n }) => ({
        n,
        comments: rows
          .filter((c) => c.conversationId === id)
          .map((c) => ({ id: c.id, text: c.text, done: c.state === "done", note: c.note })),
      }));

    const fresh: NewCommentInput[] = drafts.map((c) => ({
      ...byId.get(c.id)!,
      componentName: c.componentName,
      x: c.x,
      y: c.y,
      text: c.text,
    }));
    return ok({ ids: drafts.map((c) => c.id), prompt: describeComments(fresh, earlier) });
  } catch (_e) {
    return dbError("Failed to describe comments");
  }
};

// The drafts a message carries, sent into its chat: they're that chat's set
// from here on. All or none: if any isn't a draft any more (another send
// took it, or it was deleted), nothing is marked and the send must not go.
export const markCommentsSent = async (
  workspaceId: string,
  conversationId: string,
  ids: number[],
) => {
  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(comments)
        .set({ state: "sent", conversationId, sentAt: new Date() })
        .where(
          and(
            eq(comments.workspaceId, workspaceId),
            eq(comments.state, "draft"),
            inArray(comments.id, ids),
          ),
        )
        .returning({ id: comments.id });
      if (rows.length !== new Set(ids).size) tx.rollback();
    });
    commentEvents.emit("changed", workspaceId);
    return ok(true);
  } catch (e) {
    if (e instanceof TransactionRollbackError)
      return err({ status: 409 as const, code: "COMMENTS_CHANGED", message: "Some of these comments were already sent or removed" });
    return dbError("Failed to mark comments sent");
  }
};

// Claude's report on one comment of its chat's set: done, and what changed.
// Marking one again replaces its note. A comment from another chat's set
// isn't this chat's to mark.
export const completeComment = async (
  conversationId: string,
  id: number,
  note: string,
) => {
  try {
    const [row] = await db
      .update(comments)
      .set({ state: "done", note: note.trim(), completedAt: new Date() })
      .where(and(eq(comments.id, id), eq(comments.conversationId, conversationId)))
      .returning();
    if (!row) return notFound(`Comment ${id} isn't one of this chat's`);
    commentEvents.emit("changed", row.workspaceId);
    return ok(row);
  } catch (_e) {
    return dbError("Failed to complete comment");
  }
};

// Whether a conversation is one of the workspace's comment chats: its phase
// is part of the list, so its state changes are the list's news too.
export const isCommentChat = async (workspaceId: string, conversationId: string) => {
  try {
    const [row] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(eq(comments.workspaceId, workspaceId), eq(comments.conversationId, conversationId)),
      )
      .limit(1);
    return ok(!!row);
  } catch (_e) {
    return dbError("Failed to look up the chat's comments");
  }
};
