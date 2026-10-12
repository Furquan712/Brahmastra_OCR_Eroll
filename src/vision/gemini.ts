import { GoogleGenAI } from "@google/genai";
import { NonRetryableError, RetryableError, type VisionProvider, type VisionRequest, type VisionResponse } from "./types.js";

export class GeminiProvider implements VisionProvider {
  readonly name = "gemini";
  private client: GoogleGenAI;

  constructor(readonly model: string) {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!key) throw new NonRetryableError("GEMINI_API_KEY is not set");
    this.client = new GoogleGenAI({ apiKey: key });
  }

  async call(req: VisionRequest): Promise<VisionResponse> {
    const parts = req.images.map((img) => ({ inlineData: { mimeType: "image/png", data: img.toString("base64") } }));
    let res;
    try {
      res = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [...parts, { text: req.prompt }] }],
        config: {
          systemInstruction: req.system,
          responseMimeType: "application/json",
          responseJsonSchema: req.schema,
          maxOutputTokens: req.maxTokens,
          temperature: 0,
        },
      });
    } catch (e: unknown) {
      const msg = (e as Error).message ?? String(e);
      const status = (e as { status?: number }).status;
      if (status === 429 || /429|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new RetryableError(`rate limited: ${msg}`);
      if ((status && status >= 500) || /5\d\d|UNAVAILABLE|INTERNAL|fetch failed|ECONN/i.test(msg)) {
        throw new RetryableError(`server/network error: ${msg}`);
      }
      throw new NonRetryableError(`gemini API error: ${msg}`);
    }
    const cand = res.candidates?.[0];
    if (cand?.finishReason === "MAX_TOKENS") throw new RetryableError("gemini hit maxOutputTokens before finishing JSON");
    if (cand?.finishReason === "SAFETY" || cand?.finishReason === "PROHIBITED_CONTENT") {
      throw new NonRetryableError(`gemini blocked the request (${cand.finishReason})`);
    }
    return {
      text: res.text ?? "",
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
