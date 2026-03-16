import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  UserErrors,
  APIError,
  formatErrorResponse,
  detectOpenAIError,
  detectNetworkError,
  handleAPIError,
  NetworkErrors,
  FormErrors,
  AuthErrors,
  BillingErrors,
} from "@/lib/user-errors";

// ─── UserErrors constants ───────────────────────────────────────────────────

describe("UserErrors — Constants", () => {
  it("UNAUTHORIZED should have code AUTH_001", () => {
    expect(UserErrors.UNAUTHORIZED.code).toBe("AUTH_001");
    expect(UserErrors.UNAUTHORIZED.title).toBe("Not signed in");
    expect(UserErrors.UNAUTHORIZED.action).toBe("Sign In");
    expect(UserErrors.UNAUTHORIZED.actionUrl).toBe("/auth/signin");
  });

  it("INVALID_INPUT should have code VAL_001", () => {
    expect(UserErrors.INVALID_INPUT.code).toBe("VAL_001");
  });

  it("PROMPT_TOO_SHORT should have code VAL_002", () => {
    expect(UserErrors.PROMPT_TOO_SHORT.code).toBe("VAL_002");
  });

  it("PROMPT_TOO_LONG should have code VAL_003", () => {
    expect(UserErrors.PROMPT_TOO_LONG.code).toBe("VAL_003");
  });

  it("OPENAI_QUOTA_EXCEEDED should have code OPENAI_001", () => {
    expect(UserErrors.OPENAI_QUOTA_EXCEEDED.code).toBe("OPENAI_001");
  });

  it("OPENAI_INVALID_KEY should have code OPENAI_002", () => {
    expect(UserErrors.OPENAI_INVALID_KEY.code).toBe("OPENAI_002");
  });

  it("OPENAI_RATE_LIMIT should have code OPENAI_003", () => {
    expect(UserErrors.OPENAI_RATE_LIMIT.code).toBe("OPENAI_003");
  });

  it("OPENAI_SERVER_ERROR should have code OPENAI_004", () => {
    expect(UserErrors.OPENAI_SERVER_ERROR.code).toBe("OPENAI_004");
  });

  it("IFC_PARSE_FAILED should have code NODE_001", () => {
    expect(UserErrors.IFC_PARSE_FAILED.code).toBe("NODE_001");
  });

  it("NO_QUANTITIES_EXTRACTED should have code NODE_002", () => {
    expect(UserErrors.NO_QUANTITIES_EXTRACTED.code).toBe("NODE_002");
  });

  it("INVALID_BOQ_DATA should have code NODE_003", () => {
    expect(UserErrors.INVALID_BOQ_DATA.code).toBe("NODE_003");
  });

  it("INTERNAL_ERROR should have code SYS_001", () => {
    expect(UserErrors.INTERNAL_ERROR.code).toBe("SYS_001");
    expect(UserErrors.INTERNAL_ERROR.action).toBe("Try Again");
  });
});

// ─── Factory functions ──────────────────────────────────────────────────────

describe("UserErrors — Factory Functions", () => {
  describe("MISSING_REQUIRED_FIELD", () => {
    it("should generate error with field name", () => {
      const error = UserErrors.MISSING_REQUIRED_FIELD("email");
      expect(error.code).toBe("VAL_004");
      expect(error.message).toContain('"email"');
      expect(error.title).toBe("Missing required information");
    });

    it("should handle different field names", () => {
      const error = UserErrors.MISSING_REQUIRED_FIELD("project name");
      expect(error.message).toContain('"project name"');
    });
  });

  describe("RATE_LIMIT_FREE", () => {
    it("should show hours until reset", () => {
      const error = UserErrors.RATE_LIMIT_FREE(12);
      expect(error.code).toBe("RATE_001");
      expect(error.message).toContain("12 hours");
      expect(error.action).toBe("Upgrade to Pro");
      expect(error.actionUrl).toBe("/dashboard/billing");
    });

    it("should use singular hour for 1", () => {
      const error = UserErrors.RATE_LIMIT_FREE(1);
      expect(error.message).toContain("1 hour");
      expect(error.message).not.toContain("1 hours");
    });

    it("should use plural hours for > 1", () => {
      const error = UserErrors.RATE_LIMIT_FREE(5);
      expect(error.message).toContain("5 hours");
    });
  });

  describe("RATE_LIMIT_PRO", () => {
    it("should show minutes until reset", () => {
      const error = UserErrors.RATE_LIMIT_PRO(5);
      expect(error.code).toBe("RATE_002");
      expect(error.message).toContain("5 minutes");
    });

    it("should use singular minute for 1", () => {
      const error = UserErrors.RATE_LIMIT_PRO(1);
      expect(error.message).toContain("1 minute");
      expect(error.message).not.toContain("1 minutes");
    });
  });

  describe("WORKFLOW_LIMIT_REACHED", () => {
    it("should include limit number", () => {
      const error = UserErrors.WORKFLOW_LIMIT_REACHED(5);
      expect(error.code).toBe("BILL_004");
      expect(error.message).toContain("5");
      expect(error.action).toBe("Upgrade to Pro");
    });
  });

  describe("NODE_NOT_IMPLEMENTED", () => {
    it("should include node ID", () => {
      const error = UserErrors.NODE_NOT_IMPLEMENTED("GN-099");
      expect(error.code).toBe("SYS_002");
      expect(error.message).toContain('"GN-099"');
    });
  });
});

// ─── FormErrors ─────────────────────────────────────────────────────────────

describe("FormErrors — Constants and Factories", () => {
  it("INVALID_EMAIL should have code FORM_001", () => {
    expect(FormErrors.INVALID_EMAIL.code).toBe("FORM_001");
  });

  it("PASSWORD_TOO_SHORT should have code FORM_002", () => {
    expect(FormErrors.PASSWORD_TOO_SHORT.code).toBe("FORM_002");
  });

  it("PASSWORDS_DONT_MATCH should have code FORM_003", () => {
    expect(FormErrors.PASSWORDS_DONT_MATCH.code).toBe("FORM_003");
  });

  it("INVALID_URL should have code FORM_005", () => {
    expect(FormErrors.INVALID_URL.code).toBe("FORM_005");
  });

  describe("REQUIRED_FIELD factory", () => {
    it("should generate error with field name", () => {
      const error = FormErrors.REQUIRED_FIELD("username");
      expect(error.code).toBe("FORM_004");
      expect(error.message).toContain("username");
      expect(error.title).toBe("Required field missing");
    });
  });
});

// ─── AuthErrors ─────────────────────────────────────────────────────────────

describe("AuthErrors — Constants and Factories", () => {
  it("LOGIN_FAILED should have code AUTH_002", () => {
    expect(AuthErrors.LOGIN_FAILED.code).toBe("AUTH_002");
  });

  it("EMAIL_ALREADY_EXISTS should have code AUTH_003", () => {
    expect(AuthErrors.EMAIL_ALREADY_EXISTS.code).toBe("AUTH_003");
    expect(AuthErrors.EMAIL_ALREADY_EXISTS.action).toBe("Sign In");
  });

  it("SESSION_EXPIRED should have code AUTH_004", () => {
    expect(AuthErrors.SESSION_EXPIRED.code).toBe("AUTH_004");
  });

  it("NO_PERMISSION should have code AUTH_006", () => {
    expect(AuthErrors.NO_PERMISSION.code).toBe("AUTH_006");
  });

  describe("OAUTH_FAILED factory", () => {
    it("should generate error with provider name", () => {
      const error = AuthErrors.OAUTH_FAILED("Google");
      expect(error.code).toBe("AUTH_005");
      expect(error.title).toContain("Google");
      expect(error.message).toContain("Google");
    });

    it("should work with different providers", () => {
      const error = AuthErrors.OAUTH_FAILED("GitHub");
      expect(error.title).toContain("GitHub");
    });
  });
});

// ─── BillingErrors ──────────────────────────────────────────────────────────

describe("BillingErrors — Constants", () => {
  it("PAYMENT_FAILED should have code BILL_001", () => {
    expect(BillingErrors.PAYMENT_FAILED.code).toBe("BILL_001");
  });

  it("SUBSCRIPTION_INACTIVE should have code BILL_002", () => {
    expect(BillingErrors.SUBSCRIPTION_INACTIVE.code).toBe("BILL_002");
  });

  it("CARD_DECLINED should have code BILL_003", () => {
    expect(BillingErrors.CARD_DECLINED.code).toBe("BILL_003");
  });
});

// ─── NetworkErrors ──────────────────────────────────────────────────────────

describe("NetworkErrors — Constants", () => {
  it("CONNECTION_FAILED should have code NET_001", () => {
    expect(NetworkErrors.CONNECTION_FAILED.code).toBe("NET_001");
  });

  it("TIMEOUT should have code NET_002", () => {
    expect(NetworkErrors.TIMEOUT.code).toBe("NET_002");
  });

  it("OFFLINE should have code NET_003", () => {
    expect(NetworkErrors.OFFLINE.code).toBe("NET_003");
  });
});

// ─── APIError class ─────────────────────────────────────────────────────────

describe("APIError", () => {
  it("should extend Error", () => {
    const err = new APIError(UserErrors.UNAUTHORIZED);
    expect(err).toBeInstanceOf(Error);
  });

  it("should have name APIError", () => {
    const err = new APIError(UserErrors.UNAUTHORIZED);
    expect(err.name).toBe("APIError");
  });

  it("should store userError and default statusCode 500", () => {
    const err = new APIError(UserErrors.INTERNAL_ERROR);
    expect(err.userError).toBe(UserErrors.INTERNAL_ERROR);
    expect(err.statusCode).toBe(500);
  });

  it("should accept custom statusCode", () => {
    const err = new APIError(UserErrors.UNAUTHORIZED, 401);
    expect(err.statusCode).toBe(401);
  });

  it("should use userError message as Error message", () => {
    const err = new APIError(UserErrors.UNAUTHORIZED);
    expect(err.message).toBe(UserErrors.UNAUTHORIZED.message);
  });
});

// ─── formatErrorResponse ────────────────────────────────────────────────────

describe("formatErrorResponse", () => {
  it("should return structured error object", () => {
    const result = formatErrorResponse(UserErrors.UNAUTHORIZED);
    expect(result.error.title).toBe("Not signed in");
    expect(result.error.message).toBe("Please sign in to use this feature.");
    expect(result.error.code).toBe("AUTH_001");
    expect(result.error.action).toBe("Sign In");
    expect(result.error.actionUrl).toBe("/auth/signin");
  });

  it("should include details when provided", () => {
    const result = formatErrorResponse(
      UserErrors.INTERNAL_ERROR,
      "Stack trace here"
    );
    expect(result.details).toBe("Stack trace here");
  });

  it("should not include details key when not provided", () => {
    const result = formatErrorResponse(UserErrors.INTERNAL_ERROR);
    expect("details" in result).toBe(false);
  });

  it("should not include details for empty string", () => {
    const result = formatErrorResponse(UserErrors.INTERNAL_ERROR, "");
    expect("details" in result).toBe(false);
  });

  it("should work with factory-created errors", () => {
    const error = UserErrors.MISSING_REQUIRED_FIELD("name");
    const result = formatErrorResponse(error);
    expect(result.error.code).toBe("VAL_004");
    expect(result.error.message).toContain('"name"');
  });
});

// ─── detectOpenAIError ──────────────────────────────────────────────────────

describe("detectOpenAIError", () => {
  it("should detect quota exceeded by message", () => {
    const result = detectOpenAIError({ message: "You exceeded your quota" });
    expect(result).toBe(UserErrors.OPENAI_QUOTA_EXCEEDED);
  });

  it("should detect quota exceeded by insufficient_quota in message", () => {
    const result = detectOpenAIError({
      message: "insufficient_quota error occurred",
    });
    expect(result).toBe(UserErrors.OPENAI_QUOTA_EXCEEDED);
  });

  it("should detect quota exceeded by code", () => {
    const result = detectOpenAIError({
      code: "insufficient_quota",
      message: "",
    });
    expect(result).toBe(UserErrors.OPENAI_QUOTA_EXCEEDED);
  });

  it("should detect invalid key by message containing 'invalid'", () => {
    const result = detectOpenAIError({
      message: "Invalid API key provided",
    });
    expect(result).toBe(UserErrors.OPENAI_INVALID_KEY);
  });

  it("should detect invalid key by message containing 'authentication'", () => {
    const result = detectOpenAIError({
      message: "Authentication error with your API key",
    });
    expect(result).toBe(UserErrors.OPENAI_INVALID_KEY);
  });

  it("should detect invalid key by code", () => {
    const result = detectOpenAIError({
      code: "invalid_api_key",
      message: "",
    });
    expect(result).toBe(UserErrors.OPENAI_INVALID_KEY);
  });

  it("should detect rate limit by message", () => {
    const result = detectOpenAIError({
      message: "Rate limit exceeded, please try later",
    });
    expect(result).toBe(UserErrors.OPENAI_RATE_LIMIT);
  });

  it("should detect rate limit by code", () => {
    const result = detectOpenAIError({
      code: "rate_limit_exceeded",
      message: "",
    });
    expect(result).toBe(UserErrors.OPENAI_RATE_LIMIT);
  });

  it("should detect server error for status >= 500", () => {
    const result = detectOpenAIError({ status: 503, message: "server down" });
    expect(result).toBe(UserErrors.OPENAI_SERVER_ERROR);
  });

  it("should detect server error for status 500", () => {
    const result = detectOpenAIError({ status: 500, message: "oops" });
    expect(result).toBe(UserErrors.OPENAI_SERVER_ERROR);
  });

  it("should return INTERNAL_ERROR as fallback", () => {
    const result = detectOpenAIError({ message: "something unknown" });
    expect(result).toBe(UserErrors.INTERNAL_ERROR);
  });

  it("should handle null error", () => {
    const result = detectOpenAIError(null);
    expect(result).toBe(UserErrors.INTERNAL_ERROR);
  });

  it("should handle undefined error", () => {
    const result = detectOpenAIError(undefined);
    expect(result).toBe(UserErrors.INTERNAL_ERROR);
  });

  it("should handle string error", () => {
    const result = detectOpenAIError("something broke");
    expect(result).toBe(UserErrors.INTERNAL_ERROR);
  });
});

// ─── detectNetworkError ─────────────────────────────────────────────────────

describe("detectNetworkError", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    // Default: online
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("should return OFFLINE when navigator.onLine is false", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });
    const result = detectNetworkError({ message: "any error" });
    expect(result).toBe(NetworkErrors.OFFLINE);
  });

  it("should detect timeout by ECONNABORTED code", () => {
    const result = detectNetworkError({ code: "ECONNABORTED", message: "" });
    expect(result).toBe(NetworkErrors.TIMEOUT);
  });

  it("should detect timeout by message containing 'timeout'", () => {
    const result = detectNetworkError({ message: "Request timeout after 30s" });
    expect(result).toBe(NetworkErrors.TIMEOUT);
  });

  it("should detect connection failed by ENOTFOUND code", () => {
    const result = detectNetworkError({ code: "ENOTFOUND", message: "" });
    expect(result).toBe(NetworkErrors.CONNECTION_FAILED);
  });

  it("should detect connection failed by ECONNREFUSED code", () => {
    const result = detectNetworkError({ code: "ECONNREFUSED", message: "" });
    expect(result).toBe(NetworkErrors.CONNECTION_FAILED);
  });

  it("should detect connection failed by message containing 'fetch'", () => {
    const result = detectNetworkError({
      message: "Failed to fetch resource",
    });
    expect(result).toBe(NetworkErrors.CONNECTION_FAILED);
  });

  it("should return null for non-network errors", () => {
    const result = detectNetworkError({ message: "something else" });
    expect(result).toBeNull();
  });

  it("should return null for null error when online", () => {
    const result = detectNetworkError(null);
    expect(result).toBeNull();
  });

  it("should return null for undefined error when online", () => {
    const result = detectNetworkError(undefined);
    expect(result).toBeNull();
  });
});

// ─── handleAPIError ─────────────────────────────────────────────────────────

describe("handleAPIError", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("should return UNAUTHORIZED for status 401", async () => {
    const result = await handleAPIError({ status: 401, message: "not auth" });
    expect(result).toBe(UserErrors.UNAUTHORIZED);
  });

  it("should return UNAUTHORIZED for statusCode 401", async () => {
    const result = await handleAPIError({
      statusCode: 401,
      message: "not auth",
    });
    expect(result).toBe(UserErrors.UNAUTHORIZED);
  });

  it("should return rate limit error for status 429", async () => {
    const result = await handleAPIError({ status: 429, message: "too many" });
    expect(result.code).toBe("RATE_001");
  });

  it("should return rate limit error for statusCode 429", async () => {
    const result = await handleAPIError({
      statusCode: 429,
      message: "too many",
    });
    expect(result.code).toBe("RATE_001");
  });

  it("should return NO_PERMISSION for status 403", async () => {
    const result = await handleAPIError({ status: 403, message: "forbidden" });
    expect(result).toBe(AuthErrors.NO_PERMISSION);
  });

  it("should return NO_PERMISSION for statusCode 403", async () => {
    const result = await handleAPIError({
      statusCode: 403,
      message: "forbidden",
    });
    expect(result).toBe(AuthErrors.NO_PERMISSION);
  });

  it("should return already-formatted error when error.error has code and message", async () => {
    const formattedError = {
      error: { code: "CUSTOM_001", message: "Custom error", title: "Custom" },
    };
    const result = await handleAPIError(formattedError);
    expect(result.code).toBe("CUSTOM_001");
    expect(result.message).toBe("Custom error");
  });

  it("should return INTERNAL_ERROR as fallback for unknown errors", async () => {
    const result = await handleAPIError({ message: "unknown problem" });
    expect(result).toBe(UserErrors.INTERNAL_ERROR);
  });

  it("should detect network error before checking status codes", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      writable: true,
      configurable: true,
    });
    const result = await handleAPIError({ status: 401, message: "not auth" });
    // Offline check happens first
    expect(result).toBe(NetworkErrors.OFFLINE);
  });

  it("should handle null error", async () => {
    const result = await handleAPIError(null);
    expect(result).toBe(UserErrors.INTERNAL_ERROR);
  });
});
