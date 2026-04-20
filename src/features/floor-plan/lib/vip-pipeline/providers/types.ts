/**
 * Shared error class for image generation providers.
 * Allows stage-2-images.ts to categorize failures uniformly.
 */
export class ImageGenError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly kind:
      | "timeout"
      | "rate_limit"
      | "content_filter"
      | "auth"
      | "unknown",
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ImageGenError";
  }
}
