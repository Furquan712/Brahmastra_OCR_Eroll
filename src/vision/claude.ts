import Anthropic from "@anthropic-ai/sdk";
import { NonRetryableError, RetryableError, type VisionProvider, type VisionRequest, type VisionResponse } from "./types.js";

export class ClaudeProvider implements VisionProvider {
  readonly name = "claude";
  private client: Anthropic;

  constructor(
    readonly model: string,
    private readonly effort: "low" | "medium" | "high",
  ) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      // The SDK can also pick up an `ant auth login` profile; we only warn.
      console.warn("[claude] ANTHROPIC_API_KEY is not set; relying on SDK credential discovery.");
    }
    this.client = new Anthropic({ maxRetries: 0, timeout: 180_000 });
  }

  async call(req: VisionRequest): Promise<VisionResponse> {
    const content: Anthropic.ContentBlockParam[] = req.images.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/png" as const, data: img.toString("base64") },
    }));
    content.push({ type: "text", text: req.prompt });

    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content }],
        output_config: {
          effort: this.effort,
          format: { type: "json_schema", schema: req.schema },
        },
      });
    } catch (e: unknown) {
      if (e instanceof Anthropic.RateLimitError) {
        const ra = Number(e.headers?.get?.("retry-after"));
        throw new RetryableError(`rate limited: ${e.message}`, Number.isFinite(ra) ? ra * 1000 : undefined);
      }
      if (e instanceof Anthropic.InternalServerError) throw new RetryableError(`server error: ${e.message}`);
      if (e instanceof Anthropic.APIConnectionError) throw new RetryableError(`connection error: ${e.message}`);
      if (e instanceof Anthropic.APIError) {
        if (e.status === 408 || e.status === 409 || e.status === 529) throw new RetryableError(`${e.status}: ${e.message}`);
        throw new NonRetryableError(`claude API error ${e.status}: ${e.message}`);
      }
      throw e;
    }

    if (res.stop_reason === "refusal") {
      throw new NonRetryableError(`claude refused the request (${res.stop_details?.category ?? "unknown category"})`);
    }
    if (res.stop_reason === "max_tokens") {
      throw new RetryableError("claude hit max_tokens before finishing JSON");
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }
}
