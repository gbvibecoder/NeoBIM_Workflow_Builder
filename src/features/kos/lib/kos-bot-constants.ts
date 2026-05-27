/**
 * Bot-orchestration constants for 5I PR 2b+.
 *
 * Separate from `kos-constants.ts` so the bot-tool surface evolves
 * without touching the wider KOS constant catalogue. Everything in
 * here is consumed by the orchestrator, the drawing-bot tools, and the
 * system-prompt builder.
 *
 * `KOS_BOT_MAX_ITERATIONS` REPLACES the legacy
 * `KOS_BOT_MAX_TOOL_ITERATIONS` (still present in kos-constants.ts at
 * the value 5). The orchestrator imports the new constant; the legacy
 * one is kept untouched so any unrelated grep / dashboard tooling
 * doesn't break.
 */

/**
 * Hard cap on consecutive tool-use iterations within a single bot turn.
 * Bumped from 5 (pre-5I-PR-2b) to 10 to give room for the drawing
 * pipeline: parse → mapper → (BOQ + Formwork in parallel) → re-classify
 * → re-parse → final answer can take 6+ iterations on the long path.
 */
export const KOS_BOT_MAX_ITERATIONS = 10;

/**
 * Hard cap on Python sidecar calls within a single bot turn.
 * Allowance: parse + mapper + BOQ + formwork = 4 calls; +2 retry
 * headroom; total 6. Counted across ALL tool handlers (the counter is
 * shared via the per-turn ctx).
 */
export const KOS_BOT_MAX_SIDECAR_CALLS_PER_TURN = 6;

/**
 * Version marker baked into the Kalzen system prompt for auditability.
 * Bump on any prompt change. Format: `<slice>-<YYYY.MM.DD>`. The same
 * marker is rendered as an HTML-comment line at the top of the prompt
 * so it's grep-able from logs.
 */
export const KALZEN_PROMPT_VERSION = "4-2026.05.27";

/** Tool names — single source of truth (orchestrator + tests + handlers all import these). */
export const TOOL_PROCESS_DRAWING = "process_drawing";
export const TOOL_GENERATE_BOQ = "generate_boq";
export const TOOL_GENERATE_FORMWORK = "generate_formwork";
export const TOOL_GENERATE_SHOP_DRAWING = "generate_shop_drawing";

/**
 * Subset of `MapperProjectContext.application_hint` enum, surfaced
 * to the bot (and indirectly the user) when the parser's drawing
 * classifier returns UNKNOWN. Ordering is deliberate — most common
 * customer scenarios first.
 */
export const APPLICATION_HINT_SUGGESTIONS = [
  { id: "internal_partition",    label: "Internal partition" },
  { id: "villa_external",        label: "Villa external wall" },
  { id: "apartment_external_g3", label: "Apartment external (G+3)" },
  { id: "apartment_external_g5", label: "Apartment external (G+5)" },
  { id: "school_commercial_g3",  label: "School / commercial (G+3)" },
  { id: "lift_shaft_g5",         label: "Lift shaft (G+5)" },
  { id: "shear_wall_g10",        label: "Shear wall (G+10)" },
  { id: "basement_lt3m",         label: "Basement (<3m depth)" },
  { id: "basement_gt3m",         label: "Basement (>3m depth)" },
  { id: "retaining",             label: "Retaining wall" },
] as const;

/**
 * Inline cap for `KosCustomerDrawing.parseResult` (JSONB). Mapper
 * output above this size overflows to `fullParseResultS3Key`.
 * 256 KB is comfortable for typical drawings — the captured probe
 * mapper output on a 110 KB DXF was 7.4 MB, so the overflow path
 * fires on most real customer drawings.
 */
export const KOS_DRAWING_PARSE_RESULT_INLINE_CAP_BYTES = 256 * 1024;

/** Per-turn max number of attachments accepted by the chat route. */
export const KOS_CHAT_MAX_ATTACHMENT_REFS = 5;

/** Audit event names introduced by 5I PR 2b. */
export const KOS_AUDIT_5I_PR2B = {
  CHAT_ATTACHMENTS_VALIDATED: "CHAT_ATTACHMENTS_VALIDATED",
  TOOL_PROCESS_DRAWING_OK: "TOOL_PROCESS_DRAWING_OK",
  TOOL_PROCESS_DRAWING_FAIL: "TOOL_PROCESS_DRAWING_FAIL",
  TOOL_GENERATE_BOQ_OK: "TOOL_GENERATE_BOQ_OK",
  TOOL_GENERATE_FORMWORK_OK: "TOOL_GENERATE_FORMWORK_OK",
  BOT_QUOTA_EXCEEDED: "BOT_QUOTA_EXCEEDED",
} as const;
