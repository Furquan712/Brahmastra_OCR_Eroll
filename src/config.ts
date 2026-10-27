import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Provider = "claude" | "openai" | "gemini" | "mock";
export type Mode = "strip" | "page" | "card";
/** local = tesseract + algorithms only, no model, no API; hybrid/llm use a vision model. */
export type Engine = "local" | "hybrid" | "llm";

export interface Config {
  provider: Provider;
  model: string;
  effort: "low" | "medium" | "high";
  dpi: number;
  pdfConcurrency: number;
  /** Pages OCR'd at once, across all PDFs (each page is ~1 core of tesseract). */
  pageConcurrency: number;
  /** Cross-PDF Hindi name memory (data/learned/hi-names.json): learn from each PDF, use for consensus. */
  learnNames: boolean;
  ocrConcurrency: number;
  confidenceThreshold: number;
  mode: Mode;
  /** "openrouter" | "local" when the OPENROUTER switch is used, else "custom". */
  backend: "openrouter" | "local" | "custom";
  /** hybrid = tesseract locally, model only for escalated cards + transliteration; llm = model for everything. */
  engine: Engine;
  /** Hybrid: tesseract word confidence (0..1) below which a field escalates the card to the model. */
  localMinConf: number;
  /** Hybrid: how many escalated card images go into one model call. */
  escalationBatch: number;
  /** Hybrid: also send the cover page's tesseract text to the model for AC/part fields (default: OPENROUTER=true). */
  coverViaModel: boolean;
  cacheDir: string;
  tmpDir: string;
  outDir: string;
  templatesDir: string;
  templateOverride?: string;
  force: boolean;
  limitPages?: number;
  dryRun: boolean;
  bom: boolean;
  maxRetries: number;
}

const DEFAULT_MODELS: Record<Provider, string> = {
  claude: "claude-opus-5-5",
  openai: "gpt-4o",
  gemini: "gemini-2.5-pro",
  mock: "mock",
};

/** Minimal .env loader (no dependency). Does not override already-set vars. */
export function loadDotEnv(cwd = process.cwd()): void {
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function envBool(name: string, dflt: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(v);
}

function envNum(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${v}"`);
  return n;
}

export interface CliOverrides {
  out?: string;
  cache?: string;
  tmp?: string;
  template?: string;
  dpi?: number;
  mode?: string;
  engine?: string;
  localMinConf?: number;
  concurrency?: number;
  pageConcurrency?: number;
  ocrConcurrency?: number;
  provider?: string;
  model?: string;
  force?: boolean;
  /** false from --no-learn */
  learn?: boolean;
  limitPages?: number;
  dryRun?: boolean;
  bom?: boolean;
  threshold?: number;
  /** --push: send each finished PDF's rows to the dashboard (DASHBOARD_URL + DASHBOARD_INGEST_TOKEN). */
  push?: boolean;
  /** --force-push: re-send PDFs the push ledger says are already on the dashboard. */
  forcePush?: boolean;
  /** false from --no-csv */
  csv?: boolean;
}

/**
 * OPENROUTER=true  -> cheap cloud model through OpenRouter, high parallelism.
 * OPENROUTER=false -> local model through Ollama, parallelism limited to what one GPU can do.
 * Unset            -> legacy behaviour (OCR_PROVIDER / OCR_MODEL / OPENAI_BASE_URL as given).
 */
function applyBackendSwitch(): Config["backend"] {
  const raw = process.env.OPENROUTER?.trim().toLowerCase();
  if (raw === undefined || raw === "") return "custom";
  const on = ["1", "true", "yes", "on"].includes(raw);
  const cores = Math.max(2, os.cpus().length);
  const set = (k: string, v: string) => { process.env[k] = v; };
  if (on) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER=true but OPENROUTER_API_KEY is not set");
    set("OCR_PROVIDER", "openai");
    set("OPENAI_API_KEY", process.env.OPENROUTER_API_KEY);
    set("OPENAI_BASE_URL", "https://openrouter.ai/api/v1");
    set("OCR_MODEL", process.env.OPENROUTER_MODEL || "qwen/qwen3.7-flash");
    // Cloud calls are not CPU-bound: run several PDFs (tesseract) and many model calls at once.
    if (!process.env.OCR_PDF_CONCURRENCY) set("OCR_PDF_CONCURRENCY", String(Math.min(4, Math.max(2, Math.floor(cores / 2)))));
    if (!process.env.OCR_CONCURRENCY) set("OCR_CONCURRENCY", "8");
    if (!process.env.OCR_ESCALATION_BATCH) set("OCR_ESCALATION_BATCH", "10");
    if (!process.env.OCR_REQUEST_TIMEOUT_MS) set("OCR_REQUEST_TIMEOUT_MS", "180000");
    return "openrouter";
  }
  set("OCR_PROVIDER", "openai");
  set("OPENAI_API_KEY", "ollama");
  set("OPENAI_BASE_URL", process.env.OLLAMA_URL || "http://localhost:11434/v1");
  set("OCR_MODEL", process.env.OLLAMA_MODEL || "qwen3-vl:8b-instruct");
  // One local GPU: model calls are serialised (OLLAMA_NUM_PARALLEL to raise), but a second PDF's
  // tesseract work overlaps with the first PDF's model calls.
  if (!process.env.OCR_PDF_CONCURRENCY) set("OCR_PDF_CONCURRENCY", "2");
  if (!process.env.OCR_CONCURRENCY) set("OCR_CONCURRENCY", process.env.OLLAMA_NUM_PARALLEL || "1");
  if (!process.env.OCR_ESCALATION_BATCH) set("OCR_ESCALATION_BATCH", "4");
  if (!process.env.OCR_REQUEST_TIMEOUT_MS) set("OCR_REQUEST_TIMEOUT_MS", "900000");
  return "local";
}

/**
 * Absolute path with symlinks resolved (created if missing). tesseract cannot open the file
 * list of a batch through a symlinked path such as macOS's /tmp -> /private/tmp ("failed to
 * open locally with tail list.txt"), so scratch dirs are always given to it as real paths.
 */
function realDir(p: string): string {
  const abs = path.resolve(p);
  try {
    fs.mkdirSync(abs, { recursive: true });
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

export function buildConfig(o: CliOverrides, projectRoot: string): Config {
  loadDotEnv();
  const backend = applyBackendSwitch();
  const provider = (o.provider ?? process.env.OCR_PROVIDER ?? "claude").toLowerCase() as Provider;
  if (!["claude", "openai", "gemini", "mock"].includes(provider)) {
    throw new Error(`Unknown OCR_PROVIDER "${provider}" (expected claude | openai | gemini)`);
  }
  const mode = (o.mode ?? process.env.OCR_MODE ?? "strip").toLowerCase() as Mode;
  if (!["strip", "page", "card"].includes(mode)) {
    throw new Error(`Unknown mode "${mode}" (expected strip | page | card)`);
  }
  const engine = (o.engine ?? process.env.OCR_ENGINE ?? "local").toLowerCase() as Engine;
  if (!["local", "hybrid", "llm"].includes(engine)) throw new Error(`Unknown engine "${engine}" (expected local | hybrid | llm)`);
  const effortRaw = (process.env.OCR_EFFORT ?? "low").toLowerCase();
  const effort = (["low", "medium", "high"].includes(effortRaw) ? effortRaw : "low") as Config["effort"];
  const pdfConcurrency = Math.max(1, o.concurrency ?? envNum("OCR_PDF_CONCURRENCY", 2));
  if (pdfConcurrency > 2 && os.cpus().length < 4) {
    console.warn(`[config] PDF concurrency ${pdfConcurrency} on a ${os.cpus().length}-core machine; consider lowering it.`);
  }
  return {
    provider: engine === "local" ? "mock" : provider,
    model: engine === "local" ? "none" : o.model ?? process.env.OCR_MODEL ?? DEFAULT_MODELS[provider],
    effort,
    // 300 dpi is needed for tesseract to read EPIC digits reliably; the model copes with 200.
    dpi: o.dpi ?? envNum("OCR_DPI", engine === "llm" ? 200 : 300),
    backend,
    engine,
    localMinConf: o.localMinConf ?? envNum("OCR_LOCAL_MIN_CONF", 0.85),
    escalationBatch: Math.max(1, Math.floor(envNum("OCR_ESCALATION_BATCH", 10))),
    coverViaModel: engine !== "local" && envBool("OCR_COVER_LLM", backend === "openrouter"),
    pdfConcurrency,
    pageConcurrency: Math.max(1, o.pageConcurrency ?? envNum("OCR_PAGE_CONCURRENCY", os.cpus().length)),
    ocrConcurrency: Math.max(1, o.ocrConcurrency ?? envNum("OCR_CONCURRENCY", 4)),
    confidenceThreshold: o.threshold ?? envNum("OCR_CONFIDENCE_THRESHOLD", 0.7),
    mode,
    cacheDir: path.resolve(o.cache ?? process.env.OCR_CACHE_DIR ?? "./cache"),
    tmpDir: realDir(o.tmp ?? process.env.OCR_TMP_DIR ?? "./tmp"),
    outDir: path.resolve(o.out ?? process.env.OCR_OUT_DIR ?? "./output"),
    templatesDir: process.env.OCR_TEMPLATES_DIR
      ? path.resolve(process.env.OCR_TEMPLATES_DIR)
      : path.join(projectRoot, "templates"),
    templateOverride: o.template,
    force: Boolean(o.force),
    learnNames: o.learn !== false && envBool("OCR_NAME_MEMORY", true),
    limitPages: o.limitPages,
    dryRun: Boolean(o.dryRun),
    bom: Boolean(o.bom),
    maxRetries: envNum("OCR_MAX_RETRIES", 4),
  };
}
