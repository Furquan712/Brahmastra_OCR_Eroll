import OpenAI from "openai";
import { NonRetryableError, RetryableError, type VisionProvider, type VisionRequest, type VisionResponse } from "./types.js";

export class OpenAIProvider implements VisionProvider {
  readonly name = "openai";
  private client: OpenAI;

  /** Set to false after the endpoint rejects json_schema (e.g. some local/OpenAI-compatible servers). */
  private useJsonSchema = true;

  constructor(readonly model: string) {
    if (!process.env.OPENAI_API_KEY) throw new NonRetryableError("OPENAI_API_KEY is not set (for Ollama/OpenRouter set any non-empty value)");
    const timeout = Number(process.env.OCR_REQUEST_TIMEOUT_MS) || 180_000;
    // OPENAI_BASE_URL is honoured by the SDK (OpenRouter, Ollama, vLLM, ...).
    this.client = new OpenAI({ maxRetries: 0, timeout });
  }

  async call(req: VisionRequest): Promise<VisionResponse> {
    const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = req.images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/png;base64,${img.toString("base64")}`, detail: "high" as const },
    }));
    parts.push({ type: "text", text: req.prompt });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: req.system },
      { role: "user", content: parts },
    ];
    let res: OpenAI.Chat.Completions.ChatCompletion;
    try {
      res = await this.create(messages, req);
    } catch (e: unknown) {
      if (e instanceof OpenAI.BadRequestError && this.useJsonSchema && /response_format|json_schema|schema/i.test(e.message)) {
        // Endpoint does not support schema-constrained output: fall back to a plain JSON request.
        console.warn(`[openai] ${this.model}: endpoint rejected json_schema response_format; continuing with json_object (${e.message.slice(0, 120)})`);
        this.useJsonSchema = false;
        return this.call(req);
      }
      if (e instanceof OpenAI.RateLimitError) throw new RetryableError(`rate limited: ${e.message}`);
      if (e instanceof OpenAI.InternalServerError) throw new RetryableError(`server error: ${e.message}`);
      if (e instanceof OpenAI.APIConnectionError) throw new RetryableError(`connection error: ${e.message}`);
      if (e instanceof OpenAI.APIError) throw new NonRetryableError(`openai API error ${e.status}: ${e.message}`);
      throw e;
    }
    const choice = res.choices[0];
    if (!choice) throw new RetryableError("openai returned no choices");
    if (choice.finish_reason === "length") throw new RetryableError("openai hit max_tokens before finishing JSON");
    if (choice.finish_reason === "content_filter") throw new NonRetryableError("openai content filter triggered");
    return {
      text: choice.message.content ?? "",
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    };
  }

  private create(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], req: VisionRequest) {
    return this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens,
      messages,
      response_format: this.useJsonSchema
        ? { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: false } }
        : { type: "json_object" },
    });
  }
}
