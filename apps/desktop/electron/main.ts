import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { sendAiCompletion, streamAiCompletion } from "./ai";
import type { AiCompletionRequest } from "../src/types";

const DEFAULT_UI_ZOOM_FACTOR = 1;
const MIN_UI_ZOOM_FACTOR = 0.75;
const MAX_UI_ZOOM_FACTOR = 1.5;
const UI_ZOOM_STEP = 0.1;

let uiZoomFactor = DEFAULT_UI_ZOOM_FACTOR;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeZoomFactor = (value: number) =>
  Number(
    clamp(
      Math.round(value * 100) / 100,
      MIN_UI_ZOOM_FACTOR,
      MAX_UI_ZOOM_FACTOR,
    ).toFixed(2),
  );

const getSettingsPath = () =>
  join(app.getPath("userData"), "papersuper-settings.json");

const readStoredZoomFactor = async () => {
  try {
    const raw = await readFile(getSettingsPath(), "utf-8");
    const parsed = JSON.parse(raw);
    const zoomFactor = Number(parsed.uiZoomFactor);
    return Number.isFinite(zoomFactor)
      ? normalizeZoomFactor(zoomFactor)
      : DEFAULT_UI_ZOOM_FACTOR;
  } catch {
    return DEFAULT_UI_ZOOM_FACTOR;
  }
};

const persistZoomFactor = async () => {
  try {
    await writeFile(
      getSettingsPath(),
      `${JSON.stringify({ uiZoomFactor }, null, 2)}\n`,
      "utf-8",
    );
  } catch (error) {
    console.warn("Failed to persist PaperSuper zoom setting", error);
  }
};

const applyZoomFactor = (window: BrowserWindow, zoomFactor: number) => {
  uiZoomFactor = normalizeZoomFactor(zoomFactor);
  window.webContents.setZoomFactor(uiZoomFactor);
  void persistZoomFactor();
};

const applyZoomToActiveWindow = (zoomFactor: number) => {
  const window =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (window) {
    applyZoomFactor(window, zoomFactor);
  }
};

const createZoomMenuItem = (
  label: string,
  accelerator: string,
  getNextZoomFactor: () => number,
  visible = true,
): MenuItemConstructorOptions => ({
  label,
  accelerator,
  visible,
  click: () => applyZoomToActiveWindow(getNextZoomFactor()),
});

const registerApplicationMenu = () => {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? ([{ role: "appMenu" }] as MenuItemConstructorOptions[])
      : []),
    {
      label: "View",
      submenu: [
        createZoomMenuItem(
          "Zoom In",
          "CommandOrControl+Plus",
          () => uiZoomFactor + UI_ZOOM_STEP,
        ),
        createZoomMenuItem(
          "Zoom Out",
          "CommandOrControl+-",
          () => uiZoomFactor - UI_ZOOM_STEP,
        ),
        createZoomMenuItem(
          "Reset Zoom",
          "CommandOrControl+0",
          () => DEFAULT_UI_ZOOM_FACTOR,
        ),
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const registerZoomShortcuts = (window: BrowserWindow) => {
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) {
      return;
    }

    const key = input.key.toLowerCase();
    const code = input.code;
    const isZoomIn =
      key === "+" ||
      key === "=" ||
      key === "plus" ||
      key === "add" ||
      code === "Equal" ||
      code === "Plus" ||
      code === "Add" ||
      code === "NumpadAdd";
    const isZoomOut =
      key === "-" ||
      key === "_" ||
      code === "Minus" ||
      code === "NumpadSubtract";
    const isZoomReset = key === "0" || code === "Digit0" || code === "Numpad0";

    if (!isZoomIn && !isZoomOut && !isZoomReset) {
      return;
    }

    event.preventDefault();

    if (isZoomIn) {
      applyZoomFactor(window, uiZoomFactor + UI_ZOOM_STEP);
      return;
    }

    if (isZoomOut) {
      applyZoomFactor(window, uiZoomFactor - UI_ZOOM_STEP);
      return;
    }

    applyZoomFactor(window, DEFAULT_UI_ZOOM_FACTOR);
  });
};

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

  mainWindow.webContents.setZoomFactor(uiZoomFactor);
  registerZoomShortcuts(mainWindow);

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

ipcMain.handle("paperSuper:adjustUiZoom", async (_event, action: unknown) => {
  const window =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

  if (!window) {
    return uiZoomFactor;
  }

  if (action === "in") {
    applyZoomFactor(window, uiZoomFactor + UI_ZOOM_STEP);
    return uiZoomFactor;
  }

  if (action === "out") {
    applyZoomFactor(window, uiZoomFactor - UI_ZOOM_STEP);
    return uiZoomFactor;
  }

  if (action === "reset") {
    applyZoomFactor(window, DEFAULT_UI_ZOOM_FACTOR);
  }

  return uiZoomFactor;
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

app.whenReady().then(async () => {
  uiZoomFactor = await readStoredZoomFactor();
  registerApplicationMenu();
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
