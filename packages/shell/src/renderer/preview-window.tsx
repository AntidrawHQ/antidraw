import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { PreviewWindow } from "./PreviewWindow";

// A frame's own window, opened from its toolbar (see main.ts
// "open-preview-window"): the frame's preview URL is the page's ?url.
const url = new URLSearchParams(location.search).get("url") ?? "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreviewWindow url={url} />
  </StrictMode>,
);
