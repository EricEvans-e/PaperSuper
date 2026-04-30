import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "apps/desktop/electron/main.ts"),
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, "apps/desktop/electron/preload.ts"),
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, "apps/desktop"),
    build: {
      rollupOptions: {
        input: resolve(__dirname, "apps/desktop/index.html"),
      },
    },
    plugins: [react()],
    server: {
      fs: {
        allow: [
          resolve(__dirname),
          resolve(__dirname, "react-pdf-highlighter"),
        ],
      },
    },
    resolve: {
      alias: {
        "@desktop": resolve(__dirname, "apps/desktop/src"),
      },
    },
  },
});
