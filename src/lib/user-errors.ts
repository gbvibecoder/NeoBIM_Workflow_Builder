/**
 * User-friendly error messages for API failures
 * Maps error types to actionable user messages
 */
import { FREE_TIER_EXECUTIONS } from "@/features/billing/lib/plan-data";

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
  RATE_LIMIT_FREE: (_resetDays?: number): UserError => ({
    title: "Free executions used",
    message: `You've used all ${FREE_TIER_EXECUTIONS} free workflow executions. Upgrade to a paid plan to keep building!`,
    action: "Upgrade to Mini",
    actionUrl: "/dashboard/billing",
    code: "RATE_001",
  }),

  RATE_LIMIT_MINI: (resetDays: number): UserError => ({
    title: "Monthly limit reached",
    message: `Mini plan: 10 executions per month. Resets in ${resetDays} day${resetDays === 1 ? "" : "s"}.`,
    action: "Upgrade to Starter",
    actionUrl: "/dashboard/billing",
    code: "RATE_001",
  }),

  RATE_LIMIT_STARTER: (resetDays: number): UserError => ({
    title: "Monthly limit reached",
    message: `Starter plan: 30 executions per month. Resets in ${resetDays} day${resetDays === 1 ? "" : "s"}.`,
    action: "Upgrade to Pro",
    actionUrl: "/dashboard/billing",
    code: "RATE_001",
  }),

  RATE_LIMIT_PRO: (resetDays: number): UserError => ({
    title: "Monthly limit reached",
    message: `Pro plan: 100 executions per month. Resets in ${resetDays} day${resetDays === 1 ? "" : "s"}.`,
    code: "RATE_002",
  }),

  // Regeneration limits — server-enforced via Execution.metadata.regenerationCounts
  REGEN_MAX_REACHED: (max: number): UserError => ({
    title: "Maximum regeneration attempts reached",
    message: `You can regenerate each node up to ${max} time${max === 1 ? "" : "s"} per execution. Run the workflow again to start over.`,
    code: "REGEN_001",
  }),

  // Node-type limits (video, 3D, renders)
  VIDEO_LIMIT_REACHED: (limit: number): UserError => ({
    title: "Video generation limit reached",
    message: limit === 0
      ? "Video walkthroughs are not available on your current plan."
      : `You've used all ${limit} video generations this month.`,
    action: limit === 0 ? "Upgrade Plan" : "Upgrade Plan",
    actionUrl: "/dashboard/billing",
    code: "RATE_003",
  }),

  MODEL_3D_LIMIT_REACHED: (limit: number): UserError => ({
    title: "3D model limit reached",
    message: limit === 0
      ? "AI 3D models are not available on your current plan."
      : `You've used all ${limit} 3D model generations this month.`,
    action: limit === 0 ? "Upgrade to Starter" : "Upgrade Plan",
    actionUrl: "/dashboard/billing",
    code: "RATE_004",
  }),

  RENDER_LIMIT_REACHED: (limit: number): UserError => ({
    title: "Render limit reached",
    message: `You've used all ${limit} concept renders this month.`,
    action: "Upgrade Plan",
    actionUrl: "/dashboard/billing",
    code: "RATE_005",
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

  CLASH_DETECTION_FAILED: {
    title: "Clash detection failed",
    message: "Unable to analyze the IFC model for clashes. The file may be corrupted or contain no geometry.",
    code: "NODE_004",
  },

  NO_GEOMETRY_FOR_CLASHES: {
    title: "No geometry available",
    message: "Clash detection requires the raw IFC file (not pre-parsed data). Please connect an IFC Upload node directly.",
    code: "NODE_005",
  },

  // Workflow limits
  WORKFLOW_LIMIT_REACHED: (limit: number): UserError => ({
    title: "Workflow limit reached",
    message: `Your plan allows up to ${limit} workflows.`,
    action: "Upgrade your plan",
    actionUrl: "/dashboard/billing",
    code: "BILL_004",
  }),

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
export function detectOpenAIError(error: unknown): UserError {
  const err = error as Record<string, unknown> | null | undefined;
  const message = (typeof err?.message === "string" ? err.message : "").toLowerCase();
  const code = err?.code;

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
  if (typeof err?.status === "number" && err.status >= 500) {
    return UserErrors.OPENAI_SERVER_ERROR;
  }

  // Generic fallback
  return UserErrors.INTERNAL_ERROR;
}

// ─── Network Errors ───────────────────────────────────────────────────────────

export const NetworkErrors = {
  CONNECTION_FAILED: {
    title: "Connection failed",
    message: "Unable to reach the server. Please check your internet connection and try again.",
    action: "Retry",
    code: "NET_001",
  },
  
  TIMEOUT: {
    title: "Request timed out",
    message: "The request took too long to complete. Please try again.",
    action: "Try Again",
    code: "NET_002",
  },
  
  OFFLINE: {
    title: "You're offline",
    message: "No internet connection detected. Please connect to the internet and try again.",
    code: "NET_003",
  },
} as const;

// ─── Form Validation Errors ───────────────────────────────────────────────────

export const FormErrors = {
  INVALID_EMAIL: {
    title: "Invalid email",
    message: "Please enter a valid email address (e.g., you@example.com).",
    code: "FORM_001",
  },
  
  PASSWORD_TOO_SHORT: {
    title: "Password too short",
    message: "Password must be at least 8 characters long.",
    code: "FORM_002",
  },
  
  PASSWORDS_DONT_MATCH: {
    title: "Passwords don't match",
    message: "Please ensure both password fields match.",
    code: "FORM_003",
  },
  
  REQUIRED_FIELD: (fieldName: string): UserError => ({
    title: "Required field missing",
    message: `Please enter your ${fieldName}.`,
    code: "FORM_004",
  }),
  
  INVALID_URL: {
    title: "Invalid URL",
    message: "Please enter a valid URL (e.g., https://example.com).",
    code: "FORM_005",
  },

  INVALID_PHONE: {
    title: "Invalid phone number",
    message: "Please enter a valid phone number with country code (e.g., +919876543210).",
    code: "FORM_006",
  },
} as const;

// ─── Auth Errors ──────────────────────────────────────────────────────────────

export const AuthErrors = {
  LOGIN_FAILED: {
    title: "Login failed",
    message: "Invalid email or password. Please try again.",
    code: "AUTH_002",
  },
  
  EMAIL_ALREADY_EXISTS: {
    title: "Email already registered",
    message: "An account with this email already exists. Try signing in instead.",
    action: "Sign In",
    actionUrl: "/login",
    code: "AUTH_003",
  },
  
  SESSION_EXPIRED: {
    title: "Session expired",
    message: "Your session has expired. Please sign in again.",
    action: "Sign In",
    actionUrl: "/login",
    code: "AUTH_004",
  },
  
  OAUTH_FAILED: (provider: string): UserError => ({
    title: `${provider} sign-in failed`,
    message: `Unable to sign in with ${provider}. Please try again or use email instead.`,
    code: "AUTH_005",
  }),
  
  NO_PERMISSION: {
    title: "Permission denied",
    message: "You don't have permission to access this resource.",
    code: "AUTH_006",
  },

  PHONE_ALREADY_EXISTS: {
    title: "Phone number already registered",
    message: "An account with this phone number already exists. Try signing in instead.",
    action: "Sign In",
    actionUrl: "/login",
    code: "AUTH_007",
  },

  LOGIN_FAILED_PHONE: {
    title: "Login failed",
    message: "Invalid phone number or password. Please try again.",
    code: "AUTH_008",
  },
} as const;

// ─── Subscription/Billing Errors ──────────────────────────────────────────────

export const BillingErrors = {
  PAYMENT_FAILED: {
    title: "Payment failed",
    message: "Your payment could not be processed. Please check your card details and try again.",
    action: "Update Payment",
    actionUrl: "/dashboard/billing",
    code: "BILL_001",
  },
  
  SUBSCRIPTION_INACTIVE: {
    title: "Subscription inactive",
    message: "Your subscription is not active. Please upgrade to continue using this feature.",
    action: "Upgrade Now",
    actionUrl: "/dashboard/billing",
    code: "BILL_002",
  },
  
  CARD_DECLINED: {
    title: "Card declined",
    message: "Your card was declined. Please try a different payment method.",
    action: "Update Card",
    actionUrl: "/dashboard/billing",
    code: "BILL_003",
  },
} as const;

/**
 * Enhanced error detection for network failures
 */
export function detectNetworkError(error: unknown): UserError | null {
  if (!navigator.onLine) {
    return NetworkErrors.OFFLINE;
  }

  const err = error as Record<string, unknown> | null | undefined;
  const message = typeof err?.message === "string" ? err.message : "";

  if (err?.code === "ECONNABORTED" || message.includes("timeout")) {
    return NetworkErrors.TIMEOUT;
  }

  if (err?.code === "ENOTFOUND" || err?.code === "ECONNREFUSED" || message.includes("fetch")) {
    return NetworkErrors.CONNECTION_FAILED;
  }

  return null;
}

/**
 * Unified error handler for API calls
 */
export async function handleAPIError(error: unknown): Promise<UserError> {
  // Check network errors first
  const networkError = detectNetworkError(error);
  if (networkError) return networkError;

  const err = error as Record<string, unknown> | null | undefined;

  // Check if it's already a formatted API error
  const nestedError = err?.error as Record<string, unknown> | undefined;
  if (nestedError?.code && nestedError?.message) {
    return nestedError as unknown as UserError;
  }

  // Check for specific status codes
  if (err?.status === 401 || err?.statusCode === 401) {
    return UserErrors.UNAUTHORIZED;
  }

  if (err?.status === 429 || err?.statusCode === 429) {
    return UserErrors.RATE_LIMIT_FREE(30); // Default to 30 days
  }

  if (err?.status === 403 || err?.statusCode === 403) {
    return AuthErrors.NO_PERMISSION;
  }

  // Generic fallback
  return UserErrors.INTERNAL_ERROR;
}
