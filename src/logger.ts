import fs from "node:fs";
import path from "node:path";

const dataDir = path.dirname(process.env.DB_PATH || path.join(process.cwd(), "data", "escrow.sqlite"));
const runtimeLogPath = path.join(dataDir, "runtime.log");
const startupAt = new Date().toISOString();
const memoryLimit = 240;
const memoryLines: string[] = [];
let loggerInstalled = false;

function ensureLogDir() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function stringify(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pushLine(line: string) {
  memoryLines.push(line);
  while (memoryLines.length > memoryLimit) memoryLines.shift();
  try {
    ensureLogDir();
    fs.appendFileSync(runtimeLogPath, `${line}\n`, "utf-8");
  } catch {
    /* ignore */
  }
}

export function installRuntimeLogger() {
  if (loggerInstalled) return;
  loggerInstalled = true;
  ensureLogDir();
  const methods: Array<"log" | "info" | "warn" | "error"> = ["log", "info", "warn", "error"];
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const line = `[${new Date().toISOString()}] ${method.toUpperCase()} ${args.map(stringify).join(" ")}`;
      pushLine(line);
      original(...args);
    };
  }
  pushLine(`[${startupAt}] INFO Runtime logger attached`);
}

export function getRuntimeLogTail(limit = 120): string[] {
  installRuntimeLogger();
  const safeLimit = Math.max(1, Math.min(400, Math.trunc(limit) || 120));
  try {
    const lines = fs.readFileSync(runtimeLogPath, "utf-8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-safeLimit);
  } catch {
    return memoryLines.slice(-safeLimit);
  }
}

export function getStartupAt() {
  return startupAt;
}

export function getRuntimeLogPath() {
  return runtimeLogPath;
}

export function readBuildVersionNote() {
  const candidates = [
    path.resolve(process.cwd(), "BUILD_VERSION.txt"),
    path.resolve(__dirname, "..", "BUILD_VERSION.txt"),
    path.resolve(__dirname, "..", "..", "BUILD_VERSION.txt"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf-8").trim();
    } catch {
      /* ignore */
    }
  }
  return "";
}
