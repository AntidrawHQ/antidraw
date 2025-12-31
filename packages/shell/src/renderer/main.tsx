import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { sendMessage } from "@/renderer/lib/api";

window.sendMessage = sendMessage;

// window.antidrawIPC.sendMessage({
//   message: "hey there",
//   conversationId: "default-conversation",
// });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
