import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { PreviewWindow } from "./PreviewWindow";

// A frame's own window, opened from its toolbar (see main.ts
// "open-preview-window"): the frame's preview URL is the page's ?url.
const params = new URLSearchParams(location.search);
const url = params.get("url") ?? "";
// The workspace it's from, for its comments. Without one, no Comment tool.
const workspaceId = params.get("workspace");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreviewWindow url={url} workspaceId={workspaceId} />
  </StrictMode>,
);
