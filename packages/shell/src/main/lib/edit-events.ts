import { EventEmitter } from "events";

// A workspace's design edits changed: any edit, Reset, an Apply, or an
// applied set let go when its chat's turn ended. The edits event stream
// (edit.controller) relays it to subscribers, who refetch; nothing rides on
// it but the workspace.
export const editEvents = new EventEmitter<{ changed: [workspaceId: string] }>();
