import { webFrameMain, type WebContents } from "electron";
import agent from "virtual:frame-agent";
import { isPreviewUrl } from "@/shared/utils/preview-url";

// The inspector's agent (src/agent) in each preview frame a window shows,
// once it has loaded, and again after each reload. It's the app's, not the
// workspace's: it works whatever runtime the workspace has, and changes with
// the app. Only the frames the app's page holds itself, not a preview page's
// own.
export const injectFrameAgent = (contents: WebContents) => {
  contents.on("did-frame-finish-load", (_event, isMainFrame, processId, routingId) => {
    if (isMainFrame) return;
    const frame = webFrameMain.fromId(processId, routingId);
    if (!frame || frame.parent?.frameTreeNodeId !== contents.mainFrame.frameTreeNodeId || !isPreviewUrl(frame.url)) return;
    frame.executeJavaScript(agent).catch(() => {});
  });
};
