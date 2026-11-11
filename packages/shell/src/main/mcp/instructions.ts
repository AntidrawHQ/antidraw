// The server's guidance, all there is (no guide tool): what a client shows
// its agent on connecting. Under 2,000 characters, as Claude Code cuts
// instructions at 2,048.
export const INSTRUCTIONS = `Antidraw is a design canvas where every frame is a real React component, rendered live by the workspace's Vite dev server.

Call get_active_workspace first. Work in its sourcePath with your own file tools. One frame = one .tsx file with a default-exported component in src/components/user-components/; the file's name is the frame's. A new file is a new frame, and frames update live on save.

What the user wants is on the canvas:
- get_comments: notes pinned on frames, each with the element under its pin and where that's written.
- get_design_edits: style changes made in the Design panel, previewed on the frames but not in the code yet.
- get_selection: the element selected, and the elements tagged, in the inspector.

After acting, close the loop: complete_comment with a one-line note on what you changed, or dismiss_comment with why not; mark_design_edits_applied once the code has the edits, so their preview drops and the frames show your code.

Verify at a component's preview URL (https://localhost:<port>/preview?componentName=<Name>; the certificate is self-signed) or in the dev server's log (get_dev_server_info).

Don't move the user's view (open_workspace, focus_component) without a reason, such as the user asking to be shown something.`;
