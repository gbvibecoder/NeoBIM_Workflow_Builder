/**
 * User-friendly error messages for API failures
 * Maps error types to actionable user messages
 */

export interface UserError {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
  code: string; // For debugging/logs
}

export class APIError extends Error {
  constructor(
    public userError: UserError,
    public statusCode: number = 500
  ) {
    super(userError.message);
    this.name = "APIError";
  }
}

// Error message library
export const UserErrors = {
  // Authentication
  UNAUTHORIZED: {
    title: "Not signed in",
    message: "Please sign in to use this feature.",
    action: "Sign In",
    actionUrl: "/auth/signin",
    code: "AUTH_001",
  },

  // Validation
  INVALID_INPUT: {
    title: "Invalid input",
    message: "Please check your input and try again.",
    code: "VAL_001",
  },

  PROMPT_TOO_SHORT: {
    title: "Prompt too short",
    message: "Please provide a more detailed description (at least 10 characters).",
    code: "VAL_002",
  },

  PROMPT_TOO_LONG: {
    title: "Prompt too long",
    message: "Please keep your prompt under 500 characters.",
    code: "VAL_003",
  },

  MISSING_REQUIRED_FIELD: (field: string): UserError => ({
    title: "Missing required information",
    message: `The field "${field}" is required.`,
    code: "VAL_004",
  }),

  // Rate Limiting
  RATE_LIMIT_FREE: (resetHours: number): UserError => ({
    title: "Daily limit reached",
    message: `Free tier: 3 executions per day. Resets in ${resetHours} hour${resetHours === 1 ? "" : "s"}.`,
    action: "Upgrade to Pro",
    actionUrl: "/dashboard/billing",
    code: "RATE_001",
  }),

  RATE_LIMIT_PRO: (resetMinutes: number): UserError => ({
    title: "Rate limit exceeded",
    message: `Too many requests. Please wait ${resetMinutes} minute${resetMinutes === 1 ? "" : "s"} and try again.`,
    code: "RATE_002",
  }),

  // OpenAI Errors
  OPENAI_QUOTA_EXCEEDED: {
    title: "AI service quota exceeded",
    message: "Your OpenAI API key has reached its usage limit. Add billing to your OpenAI account or use platform credits.",
    action: "Add API Key",
    actionUrl: "/dashboard/settings",
    code: "OPENAI_001",
  },

  OPENAI_INVALID_KEY: {
    title: "Invalid API key",
    message: "The OpenAI API key is invalid or has been revoked. Please check your settings.",
    action: "Update API Key",
    actionUrl: "/dashboard/settings",
    code: "OPENAI_002",
  },

  OPENAI_RATE_LIMIT: {
    title: "AI service busy",
    message: "OpenAI is temporarily rate limiting requests. This usually resolves in a few moments.",
    action: "Try Again",
    code: "OPENAI_003",
  },

  OPENAI_SERVER_ERROR: {
    title: "AI service error",
    message: "OpenAI is experiencing issues. Please try again in a moment.",
    action: "Try Again",
    code: "OPENAI_004",
  },

  // Node-specific
  IFC_PARSE_FAILED: {
    title: "IFC file error",
    message: "Unable to parse the IFC file. Please ensure it's a valid IFC2x3 or IFC4 file.",
    code: "NODE_001",
  },

  NO_QUANTITIES_EXTRACTED: {
    title: "No quantities found",
    message: "Unable to extract quantities from the IFC file. The file may be empty or incompatible.",
    code: "NODE_002",
  },

  INVALID_BOQ_DATA: {
    title: "Invalid BOQ data",
    message: "The bill of quantities data is incomplete or malformed.",
    code: "NODE_003",
  },

  // Generic
  INTERNAL_ERROR: {
    title: "Something went wrong",
    message: "An unexpected error occurred. Our team has been notified.",
    action: "Try Again",
    code: "SYS_001",
  },

  NODE_NOT_IMPLEMENTED: (nodeId: string): UserError => ({
    title: "Node not available",
    message: `The node "${nodeId}" is not yet implemented.`,
    code: "SYS_002",
  }),
} as const;

/**
 * Format error for JSON response
 */
export function formatErrorResponse(error: UserError, details?: string) {
  return {
    error: {
      title: error.title,
      message: error.message,
      action: error.action,
      actionUrl: error.actionUrl,
      code: error.code,
    },
    ...(details && { details }), // Only include if provided
  };
}

/**
 * Detect OpenAI error type from error message/code
 */
export function detectOpenAIError(error: any): UserError {
  const message = error?.message?.toLowerCase() || "";
  const code = error?.code;

  // Quota exceeded
  if (
    message.includes("quota") ||
    message.includes("insufficient_quota") ||
    code === "insufficient_quota"
  ) {
    return UserErrors.OPENAI_QUOTA_EXCEEDED;
  }

  // Invalid API key
  if (
    message.includes("invalid") ||
    message.includes("authentication") ||
    code === "invalid_api_key"
  ) {
    return UserErrors.OPENAI_INVALID_KEY;
  }

  // Rate limiting
  if (message.includes("rate") || code === "rate_limit_exceeded") {
    return UserErrors.OPENAI_RATE_LIMIT;
  }

  // Server error
  if (error?.status >= 500) {
    return UserErrors.OPENAI_SERVER_ERROR;
  }

  // Generic fallback
  return UserErrors.INTERNAL_ERROR;
}
