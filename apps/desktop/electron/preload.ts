import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("paperSuper", {
  openPdfFile: () => ipcRenderer.invoke("paperSuper:openPdfFile"),
  sendAiMessage: (request: unknown) =>
    ipcRenderer.invoke("paperSuper:sendAiMessage", request),
  sendAiMessageStream: (requestId: string, request: unknown) =>
    ipcRenderer.invoke("paperSuper:sendAiMessageStream", requestId, request),
  onAiStreamEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on("paperSuper:aiStreamEvent", listener);
    return () => ipcRenderer.removeListener("paperSuper:aiStreamEvent", listener);
  },
});
