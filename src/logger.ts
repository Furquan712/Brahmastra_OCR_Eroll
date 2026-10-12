import fs from "node:fs";
import path from "node:path";

export type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  private stream: fs.WriteStream | null = null;
  private minLevel: Level;
  readonly file: string | null;
  private counts: Record<Level, number> = { debug: 0, info: 0, warn: 0, error: 0 };

  constructor(opts: { file?: string; level?: Level } = {}) {
    this.minLevel = opts.level ?? ((process.env.OCR_LOG_LEVEL as Level) || "info");
    this.file = opts.file ?? null;
    if (opts.file) {
      fs.mkdirSync(path.dirname(opts.file), { recursive: true });
      this.stream = fs.createWriteStream(opts.file, { flags: "a" });
    }
  }

  private emit(level: Level, scope: string, msg: string): void {
    this.counts[level]++;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
    // File gets everything at debug+; console respects minLevel.
    this.stream?.write(line + "\n");
    if (ORDER[level] >= ORDER[this.minLevel]) {
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }
  }

  debug(scope: string, msg: string): void { this.emit("debug", scope, msg); }
  info(scope: string, msg: string): void { this.emit("info", scope, msg); }
  warn(scope: string, msg: string): void { this.emit("warn", scope, msg); }
  error(scope: string, msg: string): void { this.emit("error", scope, msg); }

  get warnCount(): number { return this.counts.warn; }
  get errorCount(): number { return this.counts.error; }

  async close(): Promise<void> {
    if (!this.stream) return;
    await new Promise<void>((resolve) => this.stream!.end(resolve));
  }
}
