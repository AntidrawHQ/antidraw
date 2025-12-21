import { contextBridge } from "electron";

// Preload script for secure context bridge
// Currently using HTTP/SSE via custom protocol instead of IPC

contextBridge.exposeInMainWorld("electronAPI", {
  // Add IPC methods here as needed
});
