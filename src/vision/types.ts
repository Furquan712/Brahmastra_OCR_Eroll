export interface VisionRequest {
  /** PNG images, in order. */
  images: Buffer[];
  system: string;
  prompt: string;
  /** JSON schema for the expected response object (providers that support it enforce it). */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
}

export interface VisionResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  call(req: VisionRequest): Promise<VisionResponse>;
}

/** Thrown for failures that should NOT be retried (bad key, bad request, refusal). */
export class NonRetryableError extends Error {}
/** Thrown for failures worth retrying (rate limit, 5xx, network, truncated JSON). */
export class RetryableError extends Error {
  constructor(msg: string, public readonly retryAfterMs?: number) {
    super(msg);
  }
}
