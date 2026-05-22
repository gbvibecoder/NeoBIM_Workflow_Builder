/**
 * KOS feature-wide constants. Single source of truth for values that
 * cross multiple modules so a model rotation or cookie-name change is
 * one edit, not a grep.
 */

// ─── Bot ──────────────────────────────────────────────────────────────

/**
 * Hardcoded Anthropic model id for the Stage B bot. Pinned here so a
 * future Claude rotation is one edit. Sonnet 4.5 is the right balance
 * of price / quality / tool-use reliability for Phase 3A.
 */
export const KOS_BOT_MODEL = "claude-sonnet-4-5";

/** Max Anthropic output tokens per turn. */
export const KOS_BOT_MAX_TOKENS = 2048;

/**
 * Hard cap on consecutive tool-use iterations within a single bot
 * turn. After this many the orchestrator emits KOS_BOT_002 and
 * persists whatever text it has accumulated.
 */
export const KOS_BOT_MAX_TOOL_ITERATIONS = 5;

/**
 * Conversation history depth fed into Anthropic on each turn. Lower
 * = cheaper + less context risk; higher = better continuity. 20 is
 * the spec-mandated value for Phase 3A.
 */
export const KOS_BOT_HISTORY_DEPTH = 20;

// ─── Customer auth ────────────────────────────────────────────────────

export const KOS_CUSTOMER_SESSION_COOKIE = "kos_customer_session";
export const KOS_CUSTOMER_SESSION_TTL_DAYS = 30;
export const KOS_CUSTOMER_SESSION_TTL_MS =
  KOS_CUSTOMER_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

// ─── Audit event names (free-form strings on KosAuditLog.action) ─────
//
// Using string constants here instead of a Prisma enum keeps the
// migration additive — Week 1's KosAuditLog.action column is a plain
// VARCHAR that accepts any value. New event types ship as new
// constants here; no migration required.

export const KOS_AUDIT = {
  BOT_RETRIEVAL: "BOT_RETRIEVAL",
  BOT_RESPONSE: "BOT_RESPONSE",
  BOT_ESCALATION: "BOT_ESCALATION",
  CUSTOMER_MESSAGE: "CUSTOMER_MESSAGE",
  CUSTOMER_SESSION_START: "CUSTOMER_SESSION_START",
} as const;

export type KosAuditAction = (typeof KOS_AUDIT)[keyof typeof KOS_AUDIT];
