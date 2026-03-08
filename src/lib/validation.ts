/**
 * Input validation for node execution
 * Validates inputs BEFORE hitting APIs to save quota
 */

import { UserErrors, APIError } from "./user-errors";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  userError?: ReturnType<typeof UserErrors.MISSING_REQUIRED_FIELD>;
}

/**
 * TR-003: Design Brief Analyzer
 */
export function validateTR003Input(inputData: unknown): ValidationResult {
  const input = inputData as Record<string, unknown> | null | undefined;
  const prompt = input?.prompt ?? input?.content ?? "";

  if (typeof prompt !== "string") {
    return {
      valid: false,
      error: "Prompt must be a string",
      userError: UserErrors.INVALID_INPUT,
    };
  }

  if (prompt.trim().length < 10) {
    return {
      valid: false,
      error: "Prompt too short (min 10 chars)",
      userError: UserErrors.PROMPT_TOO_SHORT,
    };
  }

  if (prompt.length > 500) {
    return {
      valid: false,
      error: "Prompt too long (max 500 chars)",
      userError: UserErrors.PROMPT_TOO_LONG,
    };
  }

  return { valid: true };
}

/**
 * GN-003: Concept Render Generator
 */
export function validateGN003Input(inputData: unknown): ValidationResult {
  // GN-003 can accept either:
  // 1. A full building description object from TR-003 (via _raw)
  // 2. A simple prompt string

  if (!inputData) {
    return {
      valid: false,
      error: "No input data provided",
      userError: UserErrors.MISSING_REQUIRED_FIELD("description or prompt"),
    };
  }

  const input = inputData as Record<string, unknown>;

  // If it's a building description object, validate structure and return early
  // (skip prompt length checks — content/prompt may carry long upstream text)
  if (input._raw || input.projectName) {
    const desc = (input._raw ?? input) as Record<string, unknown>;
    if (!desc.projectName && !desc.buildingType) {
      return {
        valid: false,
        error: "Invalid building description",
        userError: UserErrors.INVALID_INPUT,
      };
    }
    return { valid: true };
  }

  // If it's a simple prompt (no _raw), validate length
  const prompt = input?.prompt ?? input?.content;
  if (typeof prompt === "string") {
    if (prompt.trim().length < 10) {
      return {
        valid: false,
        error: "Prompt too short (min 10 chars)",
        userError: UserErrors.PROMPT_TOO_SHORT,
      };
    }
    if (prompt.length > 4000) {
      return {
        valid: false,
        error: "Prompt too long (max 4000 chars)",
        userError: UserErrors.PROMPT_TOO_LONG,
      };
    }
  }

  return { valid: true };
}

/**
 * TR-007: Quantity Extractor
 */
export function validateTR007Input(inputData: unknown): ValidationResult {
  // TR-007 accepts IFC data or falls back to realistic quantities
  // No strict validation needed (fallback is acceptable)
  // But we should warn if no IFC data provided

  if (!inputData) {
    return {
      valid: true, // Allow (will use fallback)
    };
  }

  const input = inputData as Record<string, unknown>;

  // If IFC data is provided, check it's valid
  if (input.ifcData) {
    if (typeof input.ifcData !== "object") {
      return {
        valid: false,
        error: "Invalid IFC data format",
        userError: UserErrors.IFC_PARSE_FAILED,
      };
    }
  }

  return { valid: true };
}

/**
 * TR-008: BOQ Cost Mapper
 */
export function validateTR008Input(inputData: unknown): ValidationResult {
  // TR-008 requires elements from TR-007
  const input = inputData as Record<string, unknown> | null | undefined;
  const elements = input?._elements ?? input?.elements ?? input?.rows;

  if (!elements || !Array.isArray(elements)) {
    return {
      valid: false,
      error: "No elements to process (expected output from TR-007)",
      userError: UserErrors.MISSING_REQUIRED_FIELD("elements or rows"),
    };
  }

  if (elements.length === 0) {
    return {
      valid: false,
      error: "Empty elements array",
      userError: UserErrors.NO_QUANTITIES_EXTRACTED,
    };
  }

  return { valid: true };
}

/**
 * EX-002: BOQ Spreadsheet Exporter
 */
export function validateEX002Input(inputData: unknown): ValidationResult {
  // EX-002 requires rows and headers from TR-008
  const input = inputData as Record<string, unknown> | null | undefined;
  const rows = input?.rows;
  const headers = input?.headers;

  if (!rows || !Array.isArray(rows)) {
    return {
      valid: false,
      error: "No rows to export (expected output from TR-008)",
      userError: UserErrors.MISSING_REQUIRED_FIELD("rows"),
    };
  }

  if (!headers || !Array.isArray(headers)) {
    return {
      valid: false,
      error: "No headers provided",
      userError: UserErrors.MISSING_REQUIRED_FIELD("headers"),
    };
  }

  if (rows.length === 0) {
    return {
      valid: false,
      error: "Empty rows array",
      userError: UserErrors.INVALID_BOQ_DATA,
    };
  }

  return { valid: true };
}

/**
 * TR-001: Brief Parser
 */
export function validateTR001Input(inputData: unknown): ValidationResult {
  // TR-001 accepts PDF data or text content — at least one must be present
  const input = inputData as Record<string, unknown> | null | undefined;
  const text = input?.content ?? input?.prompt ?? input?.rawText ?? "";
  const fileData = input?.fileData ?? input?.buffer ?? null;

  if ((!text || (typeof text === "string" && text.trim().length < 20)) && !fileData) {
    return {
      valid: false,
      error: "No document content provided",
      userError: UserErrors.MISSING_REQUIRED_FIELD("document content or PDF file"),
    };
  }

  return { valid: true };
}

/**
 * TR-004: Image Understanding
 */
export function validateTR004Input(inputData: unknown): ValidationResult {
  const input = inputData as Record<string, unknown> | null | undefined;
  const base64 = input?.fileData ?? input?.imageBase64 ?? input?.base64 ?? null;
  const url = input?.url ?? null;

  if (!base64 && !url) {
    return {
      valid: false,
      error: "No image provided for analysis",
      userError: UserErrors.MISSING_REQUIRED_FIELD("image file or URL"),
    };
  }

  return { valid: true };
}

/**
 * TR-012: Site Analysis
 */
export function validateTR012Input(inputData: unknown): ValidationResult {
  const input = inputData as Record<string, unknown> | null | undefined;
  const address = input?.content ?? input?.prompt ?? input?.address ?? "";

  if (typeof address !== "string" || address.trim().length < 3) {
    return {
      valid: false,
      error: "Address too short (min 3 chars)",
      userError: UserErrors.MISSING_REQUIRED_FIELD("location address"),
    };
  }

  return { valid: true };
}

/**
 * GN-004: Floor Plan Generator
 */
export function validateGN004Input(_: unknown): ValidationResult {
  // GN-004 accepts building description or falls back to defaults
  // No strict validation — always valid
  return { valid: true };
}

/**
 * Validate input based on node catalogue ID
 */
export function validateNodeInput(
  catalogueId: string,
  inputData: unknown
): ValidationResult {
  switch (catalogueId) {
    case "TR-001":
      return validateTR001Input(inputData);
    case "TR-003":
      return validateTR003Input(inputData);
    case "TR-004":
      return validateTR004Input(inputData);
    case "TR-012":
      return validateTR012Input(inputData);
    case "GN-003":
      return validateGN003Input(inputData);
    case "GN-004":
      return validateGN004Input(inputData);
    case "TR-007":
      return validateTR007Input(inputData);
    case "TR-008":
      return validateTR008Input(inputData);
    case "EX-002":
      return validateEX002Input(inputData);
    default:
      return { valid: true }; // Unknown nodes pass (might be new)
  }
}

/**
 * Throw APIError if validation fails
 */
export function assertValidInput(
  catalogueId: string,
  inputData: unknown
): void {
  const result = validateNodeInput(catalogueId, inputData);
  if (!result.valid) {
    throw new APIError(
      result.userError ?? UserErrors.INVALID_INPUT,
      400
    );
  }
}
