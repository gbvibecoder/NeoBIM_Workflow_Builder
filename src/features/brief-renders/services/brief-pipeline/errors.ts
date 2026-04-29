/**
 * Typed errors for the Brief-to-Renders pipeline.
 *
 * Every catchable error inside the pipeline is one of these classes. Plain
 * `Error` is reserved for genuinely unexpected runtime issues we never
 * anticipated. The `code` discriminator is what the worker route maps to
 * a UserError when surfacing failures to the client; `userMessage` is the
 * safe-to-display string.
 *
 * Pattern mirrors `src/lib/user-errors.ts` shape but as a class hierarchy
 * so each thrown error carries its own type, enabling exhaustive
 * `instanceof` switches inside catch blocks.
 */

export abstract class BriefRendersError extends Error {
  abstract readonly code: string;
  abstract readonly userMessage: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    if (options?.cause !== undefined) {
      // Node 16+ supports `cause` natively; type-safe assignment without `any`.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** PDF text extraction returned no usable text (image-only / scanned PDF). */
export class EmptyPdfError extends BriefRendersError {
  readonly code = "EMPTY_PDF";
  readonly userMessage =
    "Could not extract text from the PDF. The brief may be a scanned/image-only document — please supply a text PDF or a .docx file.";
}

/** DOCX yielded neither HTML nor raw text. */
export class EmptyDocxError extends BriefRendersError {
  readonly code = "EMPTY_DOCX";
  readonly userMessage =
    "Could not extract content from the DOCX. The file may be corrupt or empty — please re-export from Word.";
}

/** Brief URL points outside our R2 bucket — refuse to fetch. */
export class UnauthorizedBriefUrlError extends BriefRendersError {
  readonly code = "UNAUTHORIZED_BRIEF_URL";
  readonly userMessage =
    "Brief URL is not from an authorized storage location. Re-upload the brief and try again.";
}

/** Brief download returned non-2xx or threw a network error. */
export class BriefDownloadError extends BriefRendersError {
  readonly code = "BRIEF_DOWNLOAD_FAILED";
  readonly userMessage =
    "Could not download the uploaded brief. Please try again in a moment.";
}

/** Brief content type / magic bytes don't match a supported format. */
export class UnsupportedBriefFormatError extends BriefRendersError {
  readonly code = "UNSUPPORTED_BRIEF_FORMAT";
  readonly userMessage =
    "Brief file format is not supported. Only PDF and DOCX briefs are accepted.";
}

/** Claude returned a response with no `tool_use` content block. */
export class MissingToolUseError extends BriefRendersError {
  readonly code = "MISSING_TOOL_USE";
  readonly userMessage =
    "The brief analyzer did not return a structured response. Please try again.";
}

/** Claude returned a tool_use whose payload failed Zod validation. */
export class InvalidSpecError extends BriefRendersError {
  readonly code = "INVALID_SPEC";
  readonly userMessage =
    "The brief analyzer returned a malformed specification. Please try again or contact support.";

  constructor(
    message: string,
    public readonly issues: ReadonlyArray<{ path: string; message: string }>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Type guard helper — narrows `unknown` to a Brief-Renders pipeline error.
 * Useful in worker route catch blocks that need to map specific codes to
 * specific HTTP statuses.
 */
export function isBriefRendersError(err: unknown): err is BriefRendersError {
  return err instanceof BriefRendersError;
}
