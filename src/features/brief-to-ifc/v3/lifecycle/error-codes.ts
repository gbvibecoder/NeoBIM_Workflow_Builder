/**
 * Brief-to-IFC v3 — exhaustive error-code enum.
 *
 * Every failure that lands in `BriefToIfcV3Run.errorCode` must be one
 * of these strings. The set is closed (a `satisfies` check at the
 * bottom enforces that). Adding a new code requires:
 *
 *   1. Append it to `BRIEF_TO_IFC_V3_ERROR_CODES`.
 *   2. Decide whether it's user-actionable (`USER_ACTIONABLE_CODES`).
 *   3. Update the diagnostic CLI's "Suggested next action" mapping in
 *      `scripts/diagnose-execution.ts`.
 *
 * Why a closed set: it makes the dashboard's error-state UI
 * exhaustive-switch-checkable, prevents typo'd code strings from
 * sneaking into the DB, and keeps the diagnostic-CLI advice mapping
 * complete.
 */

export const BRIEF_TO_IFC_V3_ERROR_CODES = [
  // --- Cost / budget exhaustion ----------------------------------------
  "COST_CAP_EXCEEDED",
  /** Phase ζ.2 — cumulative run cost (across all iterations) exceeded
   *  `RUN_COST_CAP_USD`. Distinct from `COST_CAP_EXCEEDED` (which caps
   *  a single iteration) so the dashboard / diagnostic CLI can tell
   *  "this iteration overspent" from "this RUN has spent enough across
   *  all its iterations". User-actionable: raise the cap or accept the
   *  best-so-far result. */
  "RUN_COST_CAP_EXCEEDED",
  "MAX_TURNS_EXCEEDED",
  "EXECUTION_TIMEOUT",
  // --- Sandbox / Railway failures --------------------------------------
  "SANDBOX_TIMEOUT",
  "SANDBOX_FAILURE",
  "RAILWAY_UNREACHABLE",
  "SESSION_NOT_INITIALISED",
  // --- Anthropic API failures ------------------------------------------
  "ANTHROPIC_API_ERROR",
  "MISSING_API_KEY",
  "AGENT_TIMEOUT",
  "AGENT_GAVE_UP",
  // --- Layer 1 (enrichment) failures -----------------------------------
  "BRIEF_PARSE_FAILED",
  "ENRICHMENT_FAILED",
  "ENRICHMENT_TIMEOUT",
  "ENRICHMENT_API_ERROR",
  "MISSING_TOOL_USE",
  "INVALID_BRIEF_SPEC",
  // --- Lifecycle / infrastructure --------------------------------------
  "STUCK_NO_HEARTBEAT",
  "INVALID_STATUS_TRANSITION",
  "RUN_NOT_FOUND",
  "CANCELLED_BY_USER",
  // --- Catch-all (always last) -----------------------------------------
  "UNKNOWN",
] as const;

export type BriefToIfcV3ErrorCode = (typeof BRIEF_TO_IFC_V3_ERROR_CODES)[number];

const ERROR_CODE_SET = new Set<string>(BRIEF_TO_IFC_V3_ERROR_CODES);

/** True if `code` is a member of the closed error-code set.
 *  Used by `appendLog` + `transitionStatus` to refuse persisting an
 *  unknown / mistyped code rather than silently accepting it. */
export function isBriefToIfcV3ErrorCode(
  code: unknown,
): code is BriefToIfcV3ErrorCode {
  return typeof code === "string" && ERROR_CODE_SET.has(code);
}

/** Coerce a raw error into a code. Stays defensive — never throws.
 *  When the input is a `BriefToIfcV3ErrorCode` already, returns it
 *  untouched. When it's an Error with a `.code` property matching the
 *  closed set, lifts that. Otherwise → `UNKNOWN`. */
export function toBriefToIfcV3ErrorCode(
  raw: unknown,
): BriefToIfcV3ErrorCode {
  if (isBriefToIfcV3ErrorCode(raw)) return raw;
  if (
    raw &&
    typeof raw === "object" &&
    "code" in raw &&
    isBriefToIfcV3ErrorCode((raw as { code: unknown }).code)
  ) {
    return (raw as { code: BriefToIfcV3ErrorCode }).code;
  }
  return "UNKNOWN";
}

/** Codes the user can fix without dev intervention (run again, raise
 *  cost cap, etc.). The dashboard surfaces a "Retry" CTA for these. */
export const USER_ACTIONABLE_CODES: ReadonlySet<BriefToIfcV3ErrorCode> = new Set([
  "COST_CAP_EXCEEDED",
  "RUN_COST_CAP_EXCEEDED",
  "MAX_TURNS_EXCEEDED",
  "EXECUTION_TIMEOUT",
  "SANDBOX_TIMEOUT",
  "RAILWAY_UNREACHABLE",
  "ANTHROPIC_API_ERROR",
  "AGENT_TIMEOUT",
  "STUCK_NO_HEARTBEAT",
  "CANCELLED_BY_USER",
]);

export function isUserActionable(code: BriefToIfcV3ErrorCode): boolean {
  return USER_ACTIONABLE_CODES.has(code);
}
