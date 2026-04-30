const { spawn } = require("node:child_process");

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key && !key.startsWith("=")),
);
delete env.ELECTRON_RUN_AS_NODE;

const command = process.platform === "win32" ? "electron-vite.cmd" : "electron-vite";
const args = [process.argv[2] || "dev", ...process.argv.slice(3)];

const child = spawn(command, args, {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
