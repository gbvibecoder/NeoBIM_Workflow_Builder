/**
 * Sanitize error messages for client responses.
 * In development, returns the full error message for debugging.
 * In production, returns a generic message to prevent information leakage.
 */
export function safeErrorMessage(error: unknown): string {
  if (process.env.NODE_ENV === "development") {
    return error instanceof Error ? error.message : String(error);
  }
  return "An unexpected error occurred. Please try again.";
}
