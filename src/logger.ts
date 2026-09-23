import util from "node:util";

type LogLevel = "debug" | "info" | "warn" | "error";
interface LogEntry { ts: string; level: LogLevel; message: string; }

const MAX_LOGS = 250;
const entries: LogEntry[] = [];
const startedAt = Date.now();
const globalKey = "__obra_console_patched__";
const anyGlobal = globalThis as typeof globalThis & { [globalKey]?: boolean };

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  return util.inspect(value, { depth: 4, breakLength: 120, compact: true, colors: false });
}

function push(level: LogLevel, args: unknown[]) {
  const message = args.map(formatArg).join(" ");
  entries.push({ ts: new Date().toISOString(), level, message });
  if (entries.length > MAX_LOGS) entries.splice(0, entries.length - MAX_LOGS);
}

export function getRecentLogs(limit = 80): LogEntry[] {
  return entries.slice(-Math.max(1, limit)).reverse();
}

export function getServerStartedAt(): number {
  return startedAt;
}

if (!anyGlobal[globalKey]) {
  anyGlobal[globalKey] = true;
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  console.log = (...args: unknown[]) => { push("info", args); original.log(...args); };
  console.info = (...args: unknown[]) => { push("info", args); original.info(...args); };
  console.warn = (...args: unknown[]) => { push("warn", args); original.warn(...args); };
  console.error = (...args: unknown[]) => { push("error", args); original.error(...args); };
  console.debug = (...args: unknown[]) => { push("debug", args); original.debug(...args); };
  push("info", ["Logger initialized"]);
}
