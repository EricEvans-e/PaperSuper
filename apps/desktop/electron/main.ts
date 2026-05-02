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
import { logFromMain, logFromRenderer, getLogFilePath, type LogLevel } from "./logger";
import type { AiCompletionRequest } from "../src/types";

// 这个文件运行在 Electron 主进程里。
// 主进程适合放“桌面能力”和“受信任能力”：创建窗口、打开本地文件、写用户目录、
// 发起 AI HTTP 请求、接收全局快捷键。React renderer 只通过 preload 暴露的窄 API 调用这些能力。
const DEFAULT_UI_ZOOM_FACTOR = 1;
const MIN_UI_ZOOM_FACTOR = 0.75;
const MAX_UI_ZOOM_FACTOR = 1.5;
const UI_ZOOM_STEP = 0.1;

// 全局 UI 缩放属于 Electron webContents 级别，会放大/缩小整个应用界面。
// PDF 阅读器自己的缩放在 renderer 的 PdfReaderPane 中用 pdfScale 管理，两者不要混在一起。
let uiZoomFactor = DEFAULT_UI_ZOOM_FACTOR;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// 统一做三件事：四舍五入到 0.01、限制范围、转成稳定 number。
// 这样菜单、快捷键、renderer fallback 调过来时，不会各自保存出微小浮点误差。
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

// 从 Electron userData 目录恢复上次保存的全局 UI 缩放比例。
// userData 是系统分配给当前 app 的用户数据目录，适合放偏好设置，不依赖项目所在路径。
// 读取失败、JSON 损坏、字段不是数字时都回退默认值，启动流程不因为设置文件坏掉而中断。
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

// 缩放设置是用户偏好，写入 userData，避免污染项目目录。
// 这里失败只打印 warning：缩放已经在当前窗口生效，持久化失败不应该让桌面应用崩掉。
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

// 真正应用全局缩放的唯一函数。
// setZoomFactor 作用于 BrowserWindow 的 webContents，因此会影响整个 renderer 页面。
const applyZoomFactor = (window: BrowserWindow, zoomFactor: number) => {
  uiZoomFactor = normalizeZoomFactor(zoomFactor);
  window.webContents.setZoomFactor(uiZoomFactor);
  void persistZoomFactor();
};

// 菜单项点击时不一定显式知道哪个窗口触发，所以优先取 focused window。
// 当前应用主要是单窗口，但这里保留多窗口时也能工作的写法。
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

// 注册原生菜单。菜单 accelerator 会让系统层面也知道这些快捷键，
// 同时 View 菜单保留 toggleDevTools，方便开发时打开调试器。
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

// 在主进程捕获缩放快捷键，优先于 renderer，避免 Ctrl/Cmd + +/- 被页面内部逻辑吞掉。
// 这里同时判断 key 和 code，是为了兼容不同键盘布局、主键盘和数字小键盘。
// 命中后 preventDefault，阻止 Chromium 默认页面缩放，确保只走我们自己的缩放范围和持久化逻辑。
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

// 创建主窗口。这里是 Electron 安全边界的核心配置：
// - preload 指向打包后的桥接脚本，它用 contextBridge 暴露 window.paperSuper。
// - contextIsolation: true 让 preload 和网页运行在隔离上下文，减少原型链/全局对象污染风险。
// - nodeIntegration: false 禁止 renderer 直接拿 fs、path 等 Node API。
// - sandbox: false 当前允许 preload 使用 Electron/Node 能力；renderer 仍然不能直接访问 Node。
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

  // 窗口创建后立即应用持久化的全局缩放，并为这个 webContents 绑定快捷键监听。
  mainWindow.webContents.setZoomFactor(uiZoomFactor);
  registerZoomShortcuts(mainWindow);

  // 开发模式下 electron-vite 会注入 ELECTRON_RENDERER_URL，指向 Vite dev server。
  // build/preview 模式没有这个环境变量，于是加载 out/renderer/index.html。
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

// 打开本地 PDF 必须在主进程做，因为 renderer 没有文件系统权限，也不应该获得宽泛 Node API。
// 返回给 renderer 的只有展示所需的 fileName 和 PDF 二进制数据。
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
    // Buffer 的底层 ArrayBuffer 可能比当前视图更大，所以 slice 出真实有效区间再传给 renderer。
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  };
});

// renderer 侧也监听缩放快捷键作为键盘布局 fallback，最终仍回到主进程统一应用。
// 这样即使某些平台/输入法下 before-input-event 没捕到，renderer 也只是请求主进程调整缩放。
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

// 非流式 AI 请求：当前主要用于高亮翻译等一次性结果。
// provider HTTP 逻辑集中在 ai.ts，renderer 不直接调用 OpenAI/Anthropic 接口。
ipcMain.handle(
  "paperSuper:sendAiMessage",
  async (_event, request: AiCompletionRequest) => sendAiCompletion(request),
);

// renderer 日志通过 IPC 汇总到主进程文件日志，方便排查打包后的桌面问题。
// 这条 handler 不返回业务结果，日志写入失败也由 logger.ts 做 best-effort 处理。
ipcMain.handle(
  "paperSuper:log",
  async (
    _event,
    level: LogLevel,
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ) => {
    logFromRenderer(level, category, message, data);
  },
);

// 流式 AI 请求不能直接 return 多段文本，所以用 requestId 把 delta/done/error 事件发回 renderer。
// AiChatPanel 会用 requestId 找到那条正在生成的 assistant message，并把 delta 逐段追加进去。
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
