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
 * TR-003: Building Description Generator
 */
export function validateTR003Input(inputData: any): ValidationResult {
  const prompt = inputData?.prompt ?? inputData?.content ?? "";

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
 * GN-003: Concept Image Generator
 */
export function validateGN003Input(inputData: any): ValidationResult {
  // GN-003 can accept either:
  // 1. A full building description object from TR-003
  // 2. A simple prompt string

  if (!inputData) {
    return {
      valid: false,
      error: "No input data provided",
      userError: UserErrors.MISSING_REQUIRED_FIELD("description or prompt"),
    };
  }

  // If it's a building description object, validate structure
  if (inputData._raw || inputData.projectName) {
    const desc = inputData._raw ?? inputData;
    if (!desc.projectName && !desc.buildingType) {
      return {
        valid: false,
        error: "Invalid building description",
        userError: UserErrors.INVALID_INPUT,
      };
    }
  }

  // If it's a simple prompt, validate length
  const prompt = inputData?.prompt ?? inputData?.content;
  if (typeof prompt === "string") {
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
  }

  return { valid: true };
}

/**
 * TR-007: Quantity Extractor
 */
export function validateTR007Input(inputData: any): ValidationResult {
  // TR-007 accepts IFC data or falls back to realistic quantities
  // No strict validation needed (fallback is acceptable)
  // But we should warn if no IFC data provided

  if (!inputData) {
    return {
      valid: true, // Allow (will use fallback)
    };
  }

  // If IFC data is provided, check it's valid
  if (inputData.ifcData) {
    if (typeof inputData.ifcData !== "object") {
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
export function validateTR008Input(inputData: any): ValidationResult {
  // TR-008 requires elements from TR-007
  const elements = inputData?._elements ?? inputData?.elements ?? inputData?.rows;

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
export function validateEX002Input(inputData: any): ValidationResult {
  // EX-002 requires rows and headers from TR-008
  const rows = inputData?.rows;
  const headers = inputData?.headers;

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
 * Validate input based on node catalogue ID
 */
export function validateNodeInput(
  catalogueId: string,
  inputData: any
): ValidationResult {
  switch (catalogueId) {
    case "TR-003":
      return validateTR003Input(inputData);
    case "GN-003":
      return validateGN003Input(inputData);
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
  inputData: any
): void {
  const result = validateNodeInput(catalogueId, inputData);
  if (!result.valid) {
    throw new APIError(
      result.userError ?? UserErrors.INVALID_INPUT,
      400
    );
  }
}
