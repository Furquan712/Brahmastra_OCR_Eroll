import type { z } from "zod";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { Semaphore, sleep } from "../util.js";
import { ClaudeProvider } from "./claude.js";
import { GeminiProvider } from "./gemini.js";
import { MockProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";
import { NonRetryableError, RetryableError, type VisionProvider, type VisionRequest } from "./types.js";

export { NonRetryableError, RetryableError };
export type { VisionProvider, VisionRequest };

export function createProvider(cfg: Config): VisionProvider {
  switch (cfg.provider) {
    case "claude":
      return new ClaudeProvider(cfg.model, cfg.effort);
    case "openai":
      return new OpenAIProvider(cfg.model);
    case "gemini":
      return new GeminiProvider(cfg.model);
    case "mock":
      return new MockProvider(); // dev only: synthetic output, no network
  }
}

/** Pulls a JSON object out of a model reply that may have fences or prose around it. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(t);
  if (fence) t = fence[1];
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error("no JSON object found in model reply");
  }
}

export interface CallStats {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/**
 * Rate-limited, retrying JSON call. Validates the reply with a zod schema so a
 * malformed answer is retried (once with a nudge) rather than poisoning the CSV.
 */
export class VisionClient {
  private sem: Semaphore;
  readonly stats: CallStats = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(
    readonly provider: VisionProvider,
    private readonly cfg: Config,
    private readonly log: Logger,
  ) {
    this.sem = new Semaphore(cfg.ocrConcurrency);
  }

  async callJson<T>(req: VisionRequest, schema: z.ZodType<T>, label: string): Promise<T> {
    let attempt = 0;
    let prompt = req.prompt;
    for (;;) {
      attempt++;
      try {
        const res = await this.sem.run(() => this.provider.call({ ...req, prompt }));
        this.stats.calls++;
        this.stats.inputTokens += res.inputTokens;
        this.stats.outputTokens += res.outputTokens;
        let parsed: unknown;
        try {
          parsed = extractJson(res.text);
        } catch (e) {
          throw new RetryableError(`unparseable JSON (${(e as Error).message}): ${res.text.slice(0, 200)}`);
        }
        const v = schema.safeParse(parsed);
        if (!v.success) {
          throw new RetryableError(`JSON failed schema: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        }
        return v.data;
      } catch (e: unknown) {
        if (e instanceof NonRetryableError) throw e;
        const retryable = e instanceof RetryableError;
        if (!retryable && !(e instanceof Error && /ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(e.message))) {
          throw e;
        }
        if (attempt > this.cfg.maxRetries) {
          throw new Error(`${label}: giving up after ${attempt} attempts: ${(e as Error).message}`);
        }
        const base = (e instanceof RetryableError && e.retryAfterMs) || Math.min(60_000, 1500 * 2 ** (attempt - 1));
        const delay = base + Math.floor(Math.random() * 500);
        this.log.warn("vision", `${label}: attempt ${attempt} failed (${(e as Error).message.slice(0, 160)}); retrying in ${Math.round(delay / 1000)}s`);
        if (/JSON/i.test((e as Error).message)) {
          prompt = req.prompt + "\n\nIMPORTANT: Your previous reply was not valid JSON matching the schema. Reply with ONLY the JSON object, no prose, no code fences.";
        }
        await sleep(delay);
      }
    }
  }
}
