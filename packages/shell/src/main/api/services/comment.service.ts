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
import { conversations } from "@/main/api/models/chat.model";
import { getCliState } from "@/main/lib/conversation-store";
import { commentEvents } from "@/main/lib/comment-events";
import {
  describeComments,
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

// Hands the drafts to a chat: the workspace's `into`, or a new one when
// there's none. They're sent from here on, and that chat's set. Returns the
// chat, and the message for it, which carries them and the other chats'
// earlier sets (`into` has its own). The canvas describes the elements
// (`context`): only the frames can.
export const sendComments = async (
  workspaceId: string,
  context: { id: number; element: string | null; preview: string | null; frame?: string | null }[],
  into?: string,
) => {
  try {
    const conversationId = into ?? crypto.randomUUID();
    const sent = await db.transaction(async (tx) => {
      if (into) {
        const [chat] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, into), eq(conversations.workspaceId, workspaceId)));
        if (!chat) tx.rollback();
      } else await tx.insert(conversations).values({ id: conversationId, workspaceId });
      const rows = await tx
        .update(comments)
        .set({ state: "sent", conversationId, sentAt: new Date() })
        .where(
          and(
            eq(comments.workspaceId, workspaceId),
            eq(comments.state, "draft"),
            inArray(comments.id, context.map((c) => c.id)),
          ),
        )
        .returning();
      // None left to send (another send took them): no new chat either.
      if (!rows.length) tx.rollback();
      return rows;
    });
    sent.sort((a, b) => a.id - b.id);
    commentEvents.emit("changed", workspaceId);

    const rows = await workspaceComments(workspaceId);
    const earlier: EarlierSet[] = numberedSets(rows)
      .filter((s) => s.conversationId !== conversationId)
      .slice(-HISTORY_SETS)
      .map(({ conversationId: id, n }) => ({
        n,
        comments: rows
          .filter((c) => c.conversationId === id)
          .map((c) => ({ id: c.id, text: c.text, done: c.state === "done", note: c.note })),
      }));

    const byId = new Map(context.map((c) => [c.id, c]));
    const fresh: NewCommentInput[] = sent.map((c) => ({
      id: c.id,
      componentName: c.componentName,
      x: c.x,
      y: c.y,
      text: c.text,
      element: byId.get(c.id)?.element ?? null,
      preview: byId.get(c.id)?.preview ?? null,
      frame: byId.get(c.id)?.frame ?? null,
    }));
    return ok({ conversationId, comments: sent, prompt: describeComments(fresh, earlier) });
  } catch (e) {
    if (e instanceof TransactionRollbackError) return notFound("No comments to send, or no such chat");
    return dbError("Failed to send comments");
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
