import { webFrameMain, type WebContents, type WebFrameMain } from "electron";
import agent from "virtual:frame-agent";
import { isPreviewUrl } from "@/shared/utils/preview-url";

// The inspector's agent (src/agent) in each preview frame a window shows,
// as soon as its DOM is ready (not its images), and again after each reload.
// It's the app's, not the workspace's: it works whatever runtime the
// workspace has, and changes with the app. Only the frames the app's page
// holds itself, not a preview page's own. Once its load finishes it's put
// there again, in case its DOM was ready first: the agent runs once a page.
export const injectFrameAgent = (contents: WebContents) => {
  const inject = (frame: WebFrameMain | null | undefined) => {
    if (!frame || frame.parent?.frameTreeNodeId !== contents.mainFrame.frameTreeNodeId || !isPreviewUrl(frame.url)) return;
    frame.executeJavaScript(agent).catch(() => {});
  };
  // On the frame each navigation commits to: a cross-origin page gets a
  // frame of its own, in its own process.
  contents.on("did-frame-navigate", (_event, _url, _code, _status, isMainFrame, processId, routingId) => {
    if (isMainFrame) return;
    const frame = webFrameMain.fromId(processId, routingId);
    frame?.once("dom-ready", () => inject(frame));
  });
  contents.on("did-frame-finish-load", (_event, isMainFrame, processId, routingId) => {
    if (!isMainFrame) inject(webFrameMain.fromId(processId, routingId));
  });
};
