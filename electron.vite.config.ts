import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// electron-vite 会把一个 Electron 应用拆成三个构建目标：
// 1. main：Electron 主进程，负责创建窗口、注册 IPC、调用系统能力。
// 2. preload：运行在主进程能力和 renderer 页面之间的安全桥。
// 3. renderer：浏览器环境里的前端界面，这里是 React 应用。
//
// 这三个目标的运行环境不同，所以入口、插件和打包策略也分开配置。
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          // 主进程入口。构建后会输出到 out/main/main.js，
          // package.json 里的 "main": "./out/main/main.js" 指向的就是它。
          main: resolve(__dirname, "apps/desktop/electron/main.ts"),
        },
      },
    },
    // 主进程运行在 Electron/Node 环境中。
    // externalizeDepsPlugin 会把依赖作为外部依赖处理，避免把 Node/Electron 相关依赖错误地打进 bundle。
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          // preload 入口。它通过 contextBridge 暴露 window.paperSuper，
          // renderer 想打开 PDF、发 AI 请求、写日志时都要走这层桥。
          preload: resolve(__dirname, "apps/desktop/electron/preload.ts"),
        },
      },
    },
    // preload 也运行在 Electron 提供的特殊环境里，需要保留 Node/Electron 外部依赖处理方式。
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    // renderer 的项目根目录。这里的 index.html 会按 Vite 前端项目方式处理。
    root: resolve(__dirname, "apps/desktop"),
    build: {
      rollupOptions: {
        // React renderer 的 HTML 入口。
        // apps/desktop/index.html 里再加载 /src/main.tsx，最终挂载 React App。
        input: resolve(__dirname, "apps/desktop/index.html"),
      },
    },
    // renderer 是 React + TSX，所以这里使用 Vite 的 React 插件。
    // main/preload 不是 React 页面，因此不需要这个插件。
    plugins: [react()],
    server: {
      fs: {
        // Vite dev server 默认只允许访问 renderer root 附近的文件。
        // PaperSuper 会从 apps/desktop/src/pdf-highlighter.ts 直接 re-export 仓库根目录下的
        // react-pdf-highlighter/src，所以开发模式必须允许 dev server 读取这个 vendored 源码目录。
        allow: [
          // 允许访问整个仓库，方便 renderer 引用根目录内的 vendored/source 文件。
          resolve(__dirname),
          // 明确放行 PDF 高亮库目录；它是 vendored 源码，不是 node_modules 包。
          resolve(__dirname, "react-pdf-highlighter"),
        ],
      },
    },
    resolve: {
      alias: {
        // renderer 代码的路径别名。
        // 例如可以用 @desktop/components/X 代替较长的相对路径。
        "@desktop": resolve(__dirname, "apps/desktop/src"),
      },
    },
  },
});
