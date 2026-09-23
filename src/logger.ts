import util from "util";

type RuntimeLogEntry = { ts: string; level: "log" | "info" | "warn" | "error"; message: string };
const LOG_LIMIT = 180;
const runtimeLogs: RuntimeLogEntry[] = [];
let installed = false;

function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value;
  return util.inspect(value, { depth: 4, breakLength: 120, maxArrayLength: 20, compact: true });
}

function pushLog(level: RuntimeLogEntry["level"], args: unknown[]) {
  runtimeLogs.push({
    ts: new Date().toISOString(),
    level,
    message: args.map(stringifyArg).join(" "),
  });
  if (runtimeLogs.length > LOG_LIMIT) runtimeLogs.splice(0, runtimeLogs.length - LOG_LIMIT);
}

export function installRuntimeLogger() {
  if (installed) return;
  installed = true;
  (["log", "info", "warn", "error"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = ((...args: unknown[]) => {
      pushLog(level, args);
      original(...args);
    }) as typeof console[typeof level];
  });
}

export function getRuntimeLogs(limit = 80): RuntimeLogEntry[] {
  return runtimeLogs.slice(-Math.max(1, limit)).reverse();
}
