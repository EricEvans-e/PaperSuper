import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { sendAiCompletion, streamAiCompletion } from "./ai";
import type { AiCompletionRequest } from "../src/types";

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    title: "PaperSuper",
    backgroundColor: "#101218",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

ipcMain.handle("paperSuper:openPdfFile", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open PDF",
    properties: ["openFile"],
    filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const data = await readFile(filePath);

  return {
    fileName: basename(filePath),
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  };
});

ipcMain.handle(
  "paperSuper:sendAiMessage",
  async (_event, request: AiCompletionRequest) => sendAiCompletion(request),
);

ipcMain.handle(
  "paperSuper:sendAiMessageStream",
  async (event, requestId: string, request: AiCompletionRequest) => {
    try {
      await streamAiCompletion(request, {
        onDelta: (delta) => {
          event.sender.send("paperSuper:aiStreamEvent", {
            requestId,
            type: "delta",
            delta,
          });
        },
      });
      event.sender.send("paperSuper:aiStreamEvent", {
        requestId,
        type: "done",
      });
    } catch (error) {
      event.sender.send("paperSuper:aiStreamEvent", {
        requestId,
        type: "error",
        error: error instanceof Error ? error.message : "AI stream failed",
      });
    }
  },
);

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
