import type { ChatPhase, Comment, CommentState } from "@/main/api";
import type { CommentList } from "@/renderer/lib/api";
import type { Pos } from "./store";

// The comments as the design (CommentFlow) models them: what hasn't gone out,
// and the sets that have, each with its chat. Shared by the canvas (pins, the
// box, the open comment) and the chat panel (the list).

export type CState = CommentState;
// `frame` is the component whose frame the pin is on.
export type Cmt = { id: number; text: string; state: CState; pos: Pos; frame: string };
export type Phase = ChatPhase;
export type Send = { n: number; phase: Phase; conversationId: string; comments: Cmt[] };
export type Flow = { draft: Cmt[]; sends: Send[] };

export const isActive = (s: Send) => s.phase === "opening" || s.phase === "running";
export const count = (s: Send, st: CState) => s.comments.filter((c) => c.state === st).length;
export const allDone = (s: Send) => s.phase === "ended" && s.comments.every((c) => c.state === "done");

export const LABEL: Record<CState, string> = { draft: "", sent: "Sent", done: "Completed" };

const cmt = (c: Comment): Cmt => ({ id: c.id, text: c.text, state: c.state, pos: { x: c.x, y: c.y }, frame: c.componentName });

export const toFlow = (list: CommentList | undefined): Flow => {
  if (!list) return { draft: [], sends: [] };
  return {
    draft: list.comments.filter((c) => c.state === "draft").map(cmt),
    sends: list.chats
      .map((ch) => ({ ...ch, comments: list.comments.filter((c) => c.conversationId === ch.conversationId).map(cmt) }))
      .filter((s) => s.comments.length),
  };
};

export type Actions = {
  add: (t: string) => void;
  send: () => void;
  remove: (id: number) => void;
  edit: (id: number, t: string) => void;
  dismiss: (n: number, id: number) => void;
  clearDone: () => void;
  // Hovering a row lights up its pin.
  point: (id: number | null) => void;
  // Opens a comment on the canvas, to read or (not sent only) to edit.
  open: (id: number, edit?: boolean) => void;
  opened: number | null;
  // Goes to a set's chat, in the side panel.
  chat: (conversationId: string) => void;
};
