import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { sendMessage } from "@/renderer/lib/claude-code-ops.ts";

window.sendMessage = sendMessage;

// window.designsetteIPC.sendMessage({
//   message: "hey there",
//   conversationId: "default-conversation",
// });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
