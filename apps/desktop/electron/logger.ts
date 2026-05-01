import { app } from "electron";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let minLevel: LogLevel = "DEBUG";
let logFilePath: string | null = null;
let initPromise: Promise<void> | null = null;

const getLogDir = () => join(app.getPath("userData"), "logs");

const getLogFileName = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `papersuper-${yyyy}-${mm}-${dd}.log`;
};

const initLogFile = async () => {
  const dir = getLogDir();
  await mkdir(dir, { recursive: true });
  logFilePath = join(dir, getLogFileName());
};

const ensureInit = () => {
  if (!initPromise) {
    initPromise = initLogFile();
  }
  return initPromise;
};

const formatTimestamp = () => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
};

const formatLine = (
  level: LogLevel,
  source: "MAIN" | "RENDERER",
  category: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  const ts = formatTimestamp();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `[${ts}] [${level}] [${source}] [${category}] ${message}${dataStr}\n`;
};

const writeLine = async (line: string) => {
  await ensureInit();
  if (logFilePath) {
    try {
      await appendFile(logFilePath, line, "utf-8");
    } catch {
      // Silently ignore write failures — don't crash the app over logging
    }
  }
};

export const logFromMain = (
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
    return;
  }

  const line = formatLine(level, "MAIN", category, message, data);

  // Also write to console for dev mode visibility
  const consoleMethod =
    level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  consoleMethod(line.trimEnd());

  void writeLine(line);
};

export const logFromRenderer = (
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
    return;
  }

  const line = formatLine(level, "RENDERER", category, message, data);
  void writeLine(line);
};

export const setLogLevel = (level: LogLevel) => {
  minLevel = level;
};

export const getLogFilePath = () => logFilePath;
