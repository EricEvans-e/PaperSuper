type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const LEVEL_STYLES: Record<LogLevel, string> = {
  DEBUG: "color: #6b7280",
  INFO: "color: #60a5fa",
  WARN: "color: #f59e0b",
  ERROR: "color: #ef4444; font-weight: bold",
};

let minLevel: LogLevel = "DEBUG";

const send = (
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
) => {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
    return;
  }

  // Always log to renderer console for DevTools visibility
  const prefix = `[${level}] [${category}]`;
  const consoleMethod =
    level === "ERROR"
      ? console.error
      : level === "WARN"
        ? console.warn
        : level === "DEBUG"
          ? console.debug
          : console.log;

  if (data) {
    consoleMethod(`%c${prefix} ${message}`, LEVEL_STYLES[level], data);
  } else {
    consoleMethod(`%c${prefix} ${message}`, LEVEL_STYLES[level]);
  }

  // Forward to main process for file logging (fire-and-forget)
  try {
    window.paperSuper?.log(level, category, message, data);
  } catch {
    // Preload bridge not available yet — ignore
  }
};

export const log = {
  debug: (category: string, message: string, data?: Record<string, unknown>) =>
    send("DEBUG", category, message, data),

  info: (category: string, message: string, data?: Record<string, unknown>) =>
    send("INFO", category, message, data),

  warn: (category: string, message: string, data?: Record<string, unknown>) =>
    send("WARN", category, message, data),

  error: (category: string, message: string, data?: Record<string, unknown>) =>
    send("ERROR", category, message, data),

  /** Time a labeled operation. Returns a function to call when done. */
  time: (category: string, label: string) => {
    const start = performance.now();
    log.debug(category, `${label} — started`);
    return (extra?: Record<string, unknown>) => {
      const elapsed = Math.round(performance.now() - start);
      log.info(category, `${label} — done in ${elapsed}ms`, extra);
    };
  },
};

export const setLogLevel = (level: LogLevel) => {
  minLevel = level;
};
