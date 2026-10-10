import { EventEmitter } from "events";

// A workspace's comments changed: any write, the user's or Claude's
// (complete_comment). The comments event stream (comment.controller) relays
// it to subscribers, who refetch; nothing rides on it but the workspace.
export const commentEvents = new EventEmitter<{ changed: [workspaceId: string] }>();
