import { contextBridge, ipcRenderer } from "electron";

// preload 运行在 Electron 提供的“桥接层”里。
// 它既能访问 ipcRenderer，又能在 contextIsolation 开启时安全地往网页里暴露少量 API。
// 这里故意只暴露 window.paperSuper，而不是把整个 Electron/Node 能力都交给 renderer。
contextBridge.exposeInMainWorld("paperSuper", {
  // 一次性请求：让主进程弹系统文件选择框并读取 PDF，返回 fileName + ArrayBuffer。
  openPdfFile: () => ipcRenderer.invoke("paperSuper:openPdfFile"),

  // 一次性请求：renderer 侧把“放大/缩小/重置”动作发给主进程，
  // 由主进程统一应用全局 UI 缩放并持久化。
  adjustUiZoom: (action: unknown) =>
    ipcRenderer.invoke("paperSuper:adjustUiZoom", action),

  // 一次性 AI 请求：适合翻译、结构化 JSON 生成、一次性返回完整结果的场景。
  sendAiMessage: (request: unknown) =>
    ipcRenderer.invoke("paperSuper:sendAiMessage", request),

  // 流式 AI 请求：这里只负责“启动”那次流式任务。
  // 具体的增量文本不会通过 invoke 返回，而是通过下面的 onAiStreamEvent 持续推回 renderer。
  sendAiMessageStream: (requestId: string, request: unknown) =>
    ipcRenderer.invoke("paperSuper:sendAiMessageStream", requestId, request),

  // 事件订阅：和上面的 invoke 不同，这里不是请求-响应，而是注册一个监听器，
  // 让 renderer 持续收到主进程发来的 delta/done/error 事件。
  onAiStreamEvent: (callback: (event: unknown) => void) => {
    // Electron 的原始事件对象对 renderer 业务没用，这里只把真正关心的 payload 交给上层。
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on("paperSuper:aiStreamEvent", listener);

    // 返回取消订阅函数，React 组件卸载时可以清理监听，避免重复订阅或内存泄漏。
    return () => ipcRenderer.removeListener("paperSuper:aiStreamEvent", listener);
  },

  // 把 renderer 侧日志发给主进程，由主进程集中落盘到 userData/logs。
  log: (
    level: string,
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ) => ipcRenderer.invoke("paperSuper:log", level, category, message, data),
});
