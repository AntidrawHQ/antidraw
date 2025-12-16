import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Add IPC methods here as needed
})
